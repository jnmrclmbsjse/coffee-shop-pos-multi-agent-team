import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EmploymentType, SeparationReason, StaffCustomFieldType, type StaffCustomFieldDefinition, type StaffEmploymentDetails, type StaffGovernmentIds } from '@coffee-shop/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCustomFieldDefinitionDto, UpdateCustomFieldDefinitionDto, UpdateCustomFieldValuesDto, UpdateStaffEmploymentDto } from './staff-employment.dto';

const DATE_KEYS = ['startDate', 'trainingEndDate', 'probationEndDate', 'thirdMonthReviewDate', 'regularizationDate', 'endDate', 'birthDate'] as const;
const ID_RULES = { sssNumber: [10, 10], philhealthNumber: [12, 12], pagibigNumber: [12, 12], tinNumber: [9, 13] } as const;
@Injectable()
export class StaffEmploymentService {
  constructor(private readonly prisma: PrismaService) {}

  async get(staffMemberId: string): Promise<StaffEmploymentDetails> {
    await this.requireStaff(staffMemberId);
    const [profile, history, definitions, values] = await Promise.all([
      this.prisma.staffEmploymentProfile.findUnique({ where: { staffMemberId } }),
      this.prisma.staffEmploymentTypeChange.findMany({ where: { staffMemberId }, include: { changedByUser: { select: { displayName: true, username: true } } }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.staffCustomFieldDefinition.findMany({ where: { isArchived: false }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] }),
      this.prisma.staffCustomFieldValue.findMany({ where: { staffMemberId } }),
    ]);
    const valueMap = new Map(values.map((value) => [value.definitionId, value.value]));
    const date = (value?: Date | null) => value?.toISOString().slice(0, 10) ?? null;
    const mask = (value?: string | null) => ({ isSet: Boolean(value), last4: value ? value.slice(-4) : null });
    return {
      staffMemberId,
      startDate: date(profile?.startDate), trainingEndDate: date(profile?.trainingEndDate), probationEndDate: date(profile?.probationEndDate),
      thirdMonthReviewDate: date(profile?.thirdMonthReviewDate), regularizationDate: date(profile?.regularizationDate), employmentType: profile?.employmentType ? EmploymentType[profile.employmentType] : null,
      endDate: date(profile?.endDate), separationReason: profile?.separationReason ? SeparationReason[profile.separationReason] : null, birthDate: date(profile?.birthDate),
      contactNumber: profile?.contactNumber ?? null, emergencyContactName: profile?.emergencyContactName ?? null, emergencyContactNumber: profile?.emergencyContactNumber ?? null,
      governmentIds: { sssNumber: mask(profile?.sssNumber), philhealthNumber: mask(profile?.philhealthNumber), pagibigNumber: mask(profile?.pagibigNumber), tinNumber: mask(profile?.tinNumber) },
      typeHistory: history.map((row) => ({ id: row.id, employmentType: EmploymentType[row.employmentType], effectiveDate: date(row.effectiveDate)!, changedBy: row.changedByUser, createdAt: row.createdAt.toISOString() })),
      customFields: definitions.map((definition) => ({ ...this.definition(definition, false), value: valueMap.get(definition.id) ?? null })),
    };
  }

  async reveal(staffMemberId: string): Promise<StaffGovernmentIds> {
    await this.requireStaff(staffMemberId);
    const profile = await this.prisma.staffEmploymentProfile.findUnique({ where: { staffMemberId }, select: { sssNumber: true, philhealthNumber: true, pagibigNumber: true, tinNumber: true } });
    return profile ?? { sssNumber: null, philhealthNumber: null, pagibigNumber: null, tinNumber: null };
  }

  async update(staffMemberId: string, input: UpdateStaffEmploymentDto, userId: string): Promise<StaffEmploymentDetails> {
    const staff = await this.requireStaff(staffMemberId);
    const existing = await this.prisma.staffEmploymentProfile.findUnique({ where: { staffMemberId } });
    if (existing?.employmentType && input.employmentType === null) throw new BadRequestException({ field: 'employmentType', reason: 'EMPLOYMENT_TYPE_REQUIRED', message: 'Employment type cannot be cleared' });
    const endDate = input.endDate === undefined ? existing?.endDate ?? null : input.endDate;
    const reason = input.separationReason === undefined ? existing?.separationReason ?? null : input.separationReason;
    if (Boolean(endDate) !== Boolean(reason)) throw new BadRequestException({ field: endDate ? 'separationReason' : 'endDate', reason: 'END_REASON_PAIR_REQUIRED', message: 'End date and separation reason are required together' });
    const data: Record<string, unknown> = { locationId: staff.locationId, updatedByUserId: userId };
    for (const key of DATE_KEYS) if (input[key] !== undefined) data[key] = input[key] === null ? null : this.date(input[key]!);
    for (const key of ['employmentType', 'separationReason'] as const) if (input[key] !== undefined) data[key] = input[key];
    for (const key of ['contactNumber', 'emergencyContactName', 'emergencyContactNumber'] as const) if (input[key] !== undefined) data[key] = input[key]?.trim() || null;
    for (const [key, [min, max]] of Object.entries(ID_RULES)) if ((input as Record<string, unknown>)[key] !== undefined) {
      const raw = (input as Record<string, string | null>)[key]; const normalized = raw?.replace(/[ -]/g, '') || null;
      if (normalized && (!/^\d+$/.test(normalized) || normalized.length < min || normalized.length > max)) throw new BadRequestException({ field: key, reason: 'INVALID_GOVERNMENT_ID', message: `${key} has an invalid number of digits` });
      data[key] = normalized;
    }
    const changed = input.employmentType !== undefined && input.employmentType !== existing?.employmentType;
    await this.prisma.$transaction(async (tx) => {
      await tx.staffEmploymentProfile.upsert({ where: { staffMemberId }, create: { staffMemberId, ...data } as Prisma.StaffEmploymentProfileUncheckedCreateInput, update: data });
      if (changed && input.employmentType) await tx.staffEmploymentTypeChange.create({ data: { staffMemberId, employmentType: input.employmentType, effectiveDate: this.date(input.employmentTypeEffectiveDate ?? this.today()), changedByUserId: userId } });
    });
    return this.get(staffMemberId);
  }

  async listDefinitions(includeArchived = false): Promise<StaffCustomFieldDefinition[]> {
    const rows = await this.prisma.staffCustomFieldDefinition.findMany({ where: includeArchived ? {} : { isArchived: false }, include: { _count: { select: { values: true } } }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
    return rows.map((row) => this.definition(row, row._count.values > 0));
  }
  async createDefinition(input: CreateCustomFieldDefinitionDto): Promise<StaffCustomFieldDefinition> {
    const label = this.validateLabel(input.label);
    const choices = this.validateDefinition(input.fieldType, input.choices);
    const last = await this.prisma.staffCustomFieldDefinition.aggregate({ _max: { sortOrder: true } });
    try { const row = await this.prisma.staffCustomFieldDefinition.create({ data: { label, fieldType: input.fieldType, choices, sortOrder: (last._max.sortOrder ?? -1) + 1 } }); return this.definition(row, false); }
    catch (error) { this.mapUnique(error); throw error; }
  }
  async updateDefinition(id: string, input: UpdateCustomFieldDefinitionDto): Promise<StaffCustomFieldDefinition> {
    const existing = await this.prisma.staffCustomFieldDefinition.findUnique({ where: { id }, include: { _count: { select: { values: true } } } });
    if (!existing) throw new NotFoundException('Custom field not found');
    if (input.fieldType && input.fieldType !== existing.fieldType && existing._count.values > 0) throw new ConflictException({ reason: 'CUSTOM_FIELD_TYPE_LOCKED', message: 'Field type cannot change after values are saved' });
    const fieldType = input.fieldType ?? StaffCustomFieldType[existing.fieldType];
    const choices = input.choices === undefined && input.fieldType === undefined ? undefined : this.validateDefinition(fieldType, input.choices ?? existing.choices);
    try { const row = await this.prisma.staffCustomFieldDefinition.update({ where: { id }, data: { ...input, ...(input.label === undefined ? {} : { label: this.validateLabel(input.label) }), ...(choices === undefined ? {} : { choices }) } }); return this.definition(row, existing._count.values > 0); }
    catch (error) { this.mapUnique(error); throw error; }
  }
  async reorder(ids: string[]): Promise<void> { await this.prisma.$transaction(ids.map((id, sortOrder) => this.prisma.staffCustomFieldDefinition.update({ where: { id }, data: { sortOrder } }))); }
  async saveValues(staffMemberId: string, input: UpdateCustomFieldValuesDto, userId: string): Promise<void> {
    await this.requireStaff(staffMemberId);
    const definitions = await this.prisma.staffCustomFieldDefinition.findMany({ where: { id: { in: input.values.map((value) => value.definitionId) }, isArchived: false } });
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const operations = input.values.map(({ definitionId, value }) => {
      const definition = byId.get(definitionId); if (!definition) throw new BadRequestException({ field: definitionId, message: 'Custom field is missing or archived' });
      const normalized = value.trim(); if (!normalized) return this.prisma.staffCustomFieldValue.deleteMany({ where: { staffMemberId, definitionId } });
      this.validateValue(StaffCustomFieldType[definition.fieldType], definition.choices, normalized, definitionId);
      return this.prisma.staffCustomFieldValue.upsert({ where: { staffMemberId_definitionId: { staffMemberId, definitionId } }, create: { staffMemberId, definitionId, value: normalized, updatedByUserId: userId }, update: { value: normalized, updatedByUserId: userId } });
    });
    await this.prisma.$transaction(operations);
  }
  private validateValue(type: StaffCustomFieldType, choices: string[], value: string, field: string) { if (type === StaffCustomFieldType.TEXT && value.length > 500 || type === StaffCustomFieldType.DATE && !this.isDate(value) || type === StaffCustomFieldType.NUMBER && !/^-?\d+(\.\d+)?$/.test(value) || type === StaffCustomFieldType.CHOICE && !choices.includes(value)) throw new BadRequestException({ field, reason: 'INVALID_CUSTOM_FIELD_VALUE', message: 'Custom field value is invalid' }); }
  private validateDefinition(type: StaffCustomFieldType, input: string[] | undefined) { if (type !== StaffCustomFieldType.CHOICE) return []; const choices = (input ?? []).map((choice) => choice.trim()).filter(Boolean); if (choices.length < 1 || choices.length > 30 || new Set(choices).size !== choices.length) throw new BadRequestException({ field: 'choices', message: 'Choice fields require 1–30 unique options' }); return choices; }
  private validateLabel(value: string) { const label = value.trim(); if (!label) throw new BadRequestException({ field: 'label', message: 'Label is required' }); return label; }
  private isDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value; }
  private definition(row: { id: string; label: string; fieldType: import('@prisma/client').StaffCustomFieldType; choices: string[]; sortOrder: number; isArchived: boolean }, hasValues: boolean): StaffCustomFieldDefinition { return { ...row, fieldType: StaffCustomFieldType[row.fieldType], hasValues }; }
  private mapUnique(error: unknown) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException({ field: 'label', reason: 'CUSTOM_FIELD_LABEL_EXISTS', message: 'An active field already uses this label' }); }
  private async requireStaff(id: string) { const staff = await this.prisma.staffMember.findUnique({ where: { id }, select: { id: true, locationId: true } }); if (!staff) throw new NotFoundException('Staff member not found'); return staff; }
  private date(value: string) { return new Date(`${value}T00:00:00.000Z`); }
  private today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
}
