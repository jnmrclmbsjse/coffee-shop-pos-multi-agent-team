import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { weekStartFor, type ScheduleWeekView } from '@coffee-shop/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SaveScheduleWeekDto } from './scheduling.dto';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}
  async getWeek(weekStart: string): Promise<ScheduleWeekView> {
    this.validateSunday(weekStart);
    const activeStaff = await this.prisma.staffMember.findMany({
      where: { isActive: true },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
    let source: ScheduleWeekView['source'] = 'EMPTY';
    let copiedFromWeekStartDate: string | null = null;
    let week = await this.prisma.scheduleWeek.findFirst({
      where: { locationId: null, weekStartDate: this.date(weekStart) },
      include: {
        shifts: {
          include: {
            staffMember: { select: { displayName: true, isActive: true } },
          },
        },
        dayNotes: true,
      },
    });
    if (week) source = 'SAVED';
    else {
      week = await this.prisma.scheduleWeek.findFirst({
        where: {
          locationId: null,
          weekStartDate: { lt: this.date(weekStart) },
        },
        orderBy: { weekStartDate: 'desc' },
        include: {
          shifts: {
            include: {
              staffMember: { select: { displayName: true, isActive: true } },
            },
          },
          dayNotes: true,
        },
      });
      if (week) {
        source = 'COPIED';
        copiedFromWeekStartDate = this.iso(week.weekStartDate);
      }
    }
    const editable = this.editable(weekStart);
    // A read-only saved week is history and keeps everyone who worked it; a
    // week that can still be saved, or one copied forward, drops staff who are
    // no longer active, because saving it would refuse them (ADR 0020 §7).
    const keepInactive = source === 'SAVED' && !editable;
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = this.addDays(weekStart, index);
      const sourceStart = week ? this.iso(week.weekStartDate) : weekStart;
      const sourceDate = this.addDays(sourceStart, index);
      const shifts = (week?.shifts ?? [])
        .filter(
          (shift) =>
            this.iso(shift.shiftDate) === sourceDate &&
            (keepInactive || shift.staffMember.isActive),
        )
        .map((shift) => ({
          staffMemberId: shift.staffMemberId,
          displayName: shift.staffMember.displayName,
          startMinute: shift.startMinute,
          endMinute: shift.endMinute,
        }))
        .sort(
          (a, b) =>
            a.startMinute - b.startMinute ||
            a.displayName.localeCompare(b.displayName),
        );
      const ids = new Set(shifts.map((shift) => shift.staffMemberId));
      return {
        date,
        eventNote:
          source === 'SAVED'
            ? (week?.dayNotes.find((note) => this.iso(note.noteDate) === date)
                ?.eventNote ?? null)
            : null,
        shifts,
        dayOff: activeStaff
          .filter((staff) => !ids.has(staff.id))
          .map((staff) => ({
            staffMemberId: staff.id,
            displayName: staff.displayName,
          })),
      };
    });
    return {
      weekStartDate: weekStart,
      source,
      copiedFromWeekStartDate,
      editable,
      days,
    };
  }
  async saveWeek(
    weekStart: string,
    input: SaveScheduleWeekDto,
    userId: string,
  ): Promise<ScheduleWeekView> {
    this.validateSunday(weekStart);
    if (!this.editable(weekStart))
      throw new ForbiddenException({
        reason: 'SCHEDULE_WEEK_READ_ONLY',
        message: 'Only this week and next week can be changed',
      });
    const validDates = new Set(
      Array.from({ length: 7 }, (_, i) => this.addDays(weekStart, i)),
    );
    const staffIds = new Set(
      input.days.flatMap((day) =>
        day.shifts.map((shift) => shift.staffMemberId),
      ),
    );
    const activeStaff = await this.prisma.staffMember.findMany({
      where: { id: { in: [...staffIds] }, isActive: true },
      select: { id: true },
    });
    const activeIds = new Set(activeStaff.map((staff) => staff.id));
    const seenDates = new Set<string>();
    for (const day of input.days) {
      if (!validDates.has(day.date))
        throw new BadRequestException({
          field: 'date',
          message: 'Every date must be inside the selected week',
        });
      if (seenDates.has(day.date))
        throw new BadRequestException({
          field: 'date',
          message: 'Each date can appear only once',
        });
      seenDates.add(day.date);
      const seen = new Set<string>();
      for (const shift of day.shifts) {
        if (!activeIds.has(shift.staffMemberId))
          throw new BadRequestException({
            field: 'staffMemberId',
            message: 'Staff member must exist and be active',
          });
        if (seen.has(shift.staffMemberId))
          throw new ConflictException({
            reason: 'DUPLICATE_SHIFT',
            message: 'A staff member can work only once per day',
          });
        seen.add(shift.staffMemberId);
        if (
          shift.startMinute < 0 ||
          shift.startMinute >= shift.endMinute ||
          shift.endMinute > 1440
        )
          throw new BadRequestException({
            field: 'endMinute',
            message: 'End time must be after start time on the same day',
          });
      }
      if (day.eventNote?.trim() && day.eventNote.trim().length > 200)
        throw new BadRequestException({
          field: 'eventNote',
          message: 'Event note must not exceed 200 characters',
        });
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        let week = await tx.scheduleWeek.findFirst({
          where: { locationId: null, weekStartDate: this.date(weekStart) },
          select: { id: true },
        });
        if (!week)
          week = await tx.scheduleWeek.create({
            data: {
              weekStartDate: this.date(weekStart),
              locationId: null,
              updatedByUserId: userId,
            },
            select: { id: true },
          });
        else
          await tx.scheduleWeek.update({
            where: { id: week.id },
            data: { updatedByUserId: userId },
          });
        await tx.scheduleShift.deleteMany({ where: { weekId: week.id } });
        await tx.scheduleDayNote.deleteMany({ where: { weekId: week.id } });
        const shifts = input.days.flatMap((day) =>
          day.shifts.map((shift) => ({
            weekId: week!.id,
            shiftDate: this.date(day.date),
            ...shift,
          })),
        );
        if (shifts.length) await tx.scheduleShift.createMany({ data: shifts });
        const notes = input.days
          .map((day) => ({ date: day.date, note: day.eventNote?.trim() ?? '' }))
          .filter((item) => item.note)
          .map((item) => ({
            weekId: week!.id,
            noteDate: this.date(item.date),
            eventNote: item.note,
          }));
        if (notes.length) await tx.scheduleDayNote.createMany({ data: notes });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Shifts are checked for duplicates above, so a unique violation here is
        // another administrator saving the same week at the same moment.
        throw new ConflictException({
          reason: 'SCHEDULE_WEEK_CONFLICT',
          message:
            'This week was saved by someone else at the same time. Reload and try again.',
        });
      }
      throw error;
    }
    return this.getWeek(weekStart);
  }
  private validateSunday(value: string) {
    try {
      if (!DATE.test(value) || weekStartFor(value) !== value) throw new Error();
    } catch {
      throw new BadRequestException({
        field: 'weekStart',
        message: 'weekStart must be a Sunday in YYYY-MM-DD format',
      });
    }
  }
  private editable(value: string) {
    const current = weekStartFor(this.today());
    return value === current || value === this.addDays(current, 7);
  }
  private today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
  private date(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  private iso(value: Date) {
    return value.toISOString().slice(0, 10);
  }
  private addDays(value: string, amount: number) {
    const date = this.date(value);
    date.setUTCDate(date.getUTCDate() + amount);
    return this.iso(date);
  }
}
