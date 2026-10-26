import {
  formatScheduleDayMessage,
  formatShiftTime,
  weekStartFor,
  type ScheduleDayView,
  type ScheduleWeekView,
  type StaffMember,
} from '@coffee-shop/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Notice } from '../catalog/components';
import { shopDate } from '../reporting/format';
import { listStaffMembers } from '../staff/api';
import { getScheduleWeek, saveScheduleWeek } from './api';

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function minuteToTime(value: number) {
  const minute = value === 1440 ? 0 : value;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
function timeToMinute(value: string, end = false) {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  const result = hours * 60 + minutes;
  return end && result === 0 ? 1440 : result;
}
function dayLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}
function weekLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}
function weekHeading(value: string) {
  const end = addDays(value, 6);
  const format = (date: string, year: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(year ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  return `Week of ${format(value, false)} – ${format(end, true)}`;
}

export function SchedulePage() {
  const currentWeek = weekStartFor(shopDate());
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [week, setWeek] = useState<ScheduleWeekView | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [copiedDate, setCopiedDate] = useState('');
  const [fallback, setFallback] = useState('');
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    document.title = 'Schedule · UCM Coffee Studio';
    void listStaffMembers({
      active: true,
      sort: 'name',
      direction: 'asc',
    }).then(setStaff);
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setNotice('');
    setDirty(false);
    void getScheduleWeek(weekStart)
      .then((result) => {
        if (alive) setWeek(result);
      })
      .catch(() => {
        if (alive) setError('The schedule could not be loaded.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [weekStart]);
  useEffect(() => {
    if (fallback)
      requestAnimationFrame(() => {
        fallbackRef.current?.focus();
        fallbackRef.current?.select();
      });
  }, [fallback]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function goToWeek(next: string) {
    if (next === weekStart) return;
    if (
      dirty &&
      !window.confirm(
        'Leave this week without saving? Your changes will be lost.',
      )
    )
      return;
    setWeekStart(next);
  }
  const active = useMemo(
    () => staff.filter((member) => member.isActive),
    [staff],
  );
  function updateDay(
    date: string,
    update: (day: ScheduleDayView) => ScheduleDayView,
  ) {
    setWeek((current) =>
      current
        ? {
            ...current,
            days: current.days.map((day) =>
              day.date === date ? update(day) : day,
            ),
          }
        : current,
    );
    setDirty(true);
    setNotice('');
  }
  function addShift(date: string) {
    const day = week?.days.find((candidate) => candidate.date === date);
    const available = active.find(
      (member) =>
        !day?.shifts.some((shift) => shift.staffMemberId === member.id),
    );
    if (!available) return;
    updateDay(date, (current) => ({
      ...current,
      shifts: [
        ...current.shifts,
        {
          staffMemberId: available.id,
          displayName: available.displayName,
          startMinute: 420,
          endMinute: 900,
        },
      ],
      dayOff: current.dayOff.filter(
        (member) => member.staffMemberId !== available.id,
      ),
    }));
  }
  function updateShift(
    date: string,
    index: number,
    patch: Partial<ScheduleDayView['shifts'][number]>,
  ) {
    updateDay(date, (day) => {
      const shifts = day.shifts.map((shift, position) =>
        position === index
          ? {
              ...shift,
              ...patch,
              ...(patch.staffMemberId
                ? {
                    displayName:
                      active.find((member) => member.id === patch.staffMemberId)
                        ?.displayName ?? '',
                  }
                : {}),
            }
          : shift,
      );
      const ids = new Set(shifts.map((shift) => shift.staffMemberId));
      return {
        ...day,
        shifts,
        dayOff: active
          .filter((member) => !ids.has(member.id))
          .map((member) => ({
            staffMemberId: member.id,
            displayName: member.displayName,
          })),
      };
    });
  }
  async function save() {
    if (!week || saving) return;
    for (const day of week.days) {
      if (
        new Set(day.shifts.map((shift) => shift.staffMemberId)).size !==
        day.shifts.length
      ) {
        setError(
          `Choose each staff member only once on ${dayLabel(day.date)}.`,
        );
        return;
      }
      if (day.shifts.some((shift) => shift.endMinute <= shift.startMinute)) {
        setError(`End time must be after start time on ${dayLabel(day.date)}.`);
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const saved = await saveScheduleWeek(week.weekStartDate, {
        days: week.days.map((day) => ({
          date: day.date,
          eventNote: day.eventNote,
          shifts: day.shifts.map(
            ({ staffMemberId, startMinute, endMinute }) => ({
              staffMemberId,
              startMinute,
              endMinute,
            }),
          ),
        })),
      });
      setWeek(saved);
      setDirty(false);
      setNotice('Schedule saved.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The schedule could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }
  async function copy(day: ScheduleDayView) {
    const text = formatScheduleDayMessage(day);
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(text);
      setCopiedDate(day.date);
      window.setTimeout(
        () => setCopiedDate((current) => (current === day.date ? '' : current)),
        2000,
      );
    } catch {
      setFallback(text);
    }
  }
  return (
    <main className="catalog-page schedule-page">
      <header className="catalog-page-head">
        <div>
          <h1>Schedule</h1>
          <p>Plan one shift per person, Sunday to Saturday.</p>
        </div>
        {week?.editable && (
          <button
            className="catalog-button primary"
            type="button"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save week'}
          </button>
        )}
      </header>
      <div className="schedule-toolbar">
        <button
          className="catalog-button small"
          type="button"
          aria-label="Previous week"
          onClick={() => goToWeek(addDays(weekStart, -7))}
        >
          ‹
        </button>
        <div className="schedule-tabs">
          <button
            type="button"
            aria-current={weekStart === currentWeek ? 'page' : undefined}
            onClick={() => goToWeek(currentWeek)}
          >
            This week
          </button>
          <button
            type="button"
            aria-current={
              weekStart === addDays(currentWeek, 7) ? 'page' : undefined
            }
            onClick={() => goToWeek(addDays(currentWeek, 7))}
          >
            Next week
          </button>
        </div>
        <button
          className="catalog-button small"
          type="button"
          aria-label="Next week"
          onClick={() => goToWeek(addDays(weekStart, 7))}
        >
          ›
        </button>
      </div>
      <h2>{weekHeading(weekStart)}</h2>
      {dirty && (
        <p className="schedule-unsaved" role="status">
          Unsaved changes
        </p>
      )}
      {notice && <Notice tone="success" title={notice} />}
      {error && (
        <Notice tone="danger" title="Schedule unavailable">
          <p>{error}</p>
        </Notice>
      )}
      {week?.source === 'COPIED' && (
        <p className="results-meta">
          Copied from the week of {weekLabel(week.copiedFromWeekStartDate!)}.
          Save to keep changes.
        </p>
      )}
      {week && !week.editable && (
        <p className="results-meta">
          {weekStart < currentWeek
            ? 'Past weeks are read-only.'
            : 'Only this week and next week can be edited.'}
        </p>
      )}
      {loading ? (
        <p>Loading schedule…</p>
      ) : (
        <div className="schedule-grid">
          {week?.days.map((day) => (
            <section className="schedule-day-card" key={day.date}>
              <header>
                <h3>{dayLabel(day.date)}</h3>
              </header>
              {week.editable && (
                <label className="catalog-field">
                  <span>Event note</span>
                  <input
                    value={day.eventNote ?? ''}
                    maxLength={200}
                    onChange={(event) =>
                      updateDay(day.date, (current) => ({
                        ...current,
                        eventNote: event.target.value || null,
                      }))
                    }
                  />
                </label>
              )}
              {!week.editable && day.eventNote && <p>🎉 {day.eventNote}</p>}
              {day.shifts.length === 0 && (
                <p className="staff-permanence-warning">Nobody is on duty</p>
              )}
              <div className="schedule-shifts">
                {day.shifts.map((shift, index) => (
                  <div
                    className="schedule-shift"
                    key={`${shift.staffMemberId}-${index}`}
                  >
                    {week.editable ? (
                      <>
                        <select
                          aria-label={`Staff for ${day.date}`}
                          value={shift.staffMemberId}
                          onChange={(event) =>
                            updateShift(day.date, index, {
                              staffMemberId: event.target.value,
                            })
                          }
                        >
                          {active
                            .filter(
                              (member) =>
                                member.id === shift.staffMemberId ||
                                !day.shifts.some(
                                  (other) => other.staffMemberId === member.id,
                                ),
                            )
                            .map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.displayName}
                              </option>
                            ))}
                        </select>
                        <input
                          aria-label={`Start time for ${shift.displayName}`}
                          type="time"
                          value={minuteToTime(shift.startMinute)}
                          onChange={(event) => {
                            if (event.target.value)
                              updateShift(day.date, index, {
                                startMinute: timeToMinute(event.target.value),
                              });
                          }}
                        />
                        <input
                          aria-label={`End time for ${shift.displayName}`}
                          type="time"
                          value={minuteToTime(shift.endMinute)}
                          onChange={(event) => {
                            if (event.target.value)
                              updateShift(day.date, index, {
                                endMinute: timeToMinute(
                                  event.target.value,
                                  true,
                                ),
                              });
                          }}
                        />
                        <button
                          className="catalog-button small"
                          type="button"
                          onClick={() =>
                            updateDay(day.date, (current) => {
                              const shifts = current.shifts.filter(
                                (_, position) => position !== index,
                              );
                              const ids = new Set(
                                shifts.map((item) => item.staffMemberId),
                              );
                              return {
                                ...current,
                                shifts,
                                dayOff: active
                                  .filter((member) => !ids.has(member.id))
                                  .map((member) => ({
                                    staffMemberId: member.id,
                                    displayName: member.displayName,
                                  })),
                              };
                            })
                          }
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <p>
                        <strong>{shift.displayName}</strong> ·{' '}
                        {formatShiftTime(shift.startMinute)} –{' '}
                        {formatShiftTime(shift.endMinute)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {week.editable && day.shifts.length < active.length && (
                <button
                  className="catalog-button small"
                  type="button"
                  onClick={() => addShift(day.date)}
                >
                  <Icon name="plus" /> Add staff
                </button>
              )}
              <p>
                <strong>Day off:</strong>{' '}
                {day.dayOff.length
                  ? day.dayOff.map((person) => person.displayName).join(', ')
                  : 'none'}
              </p>
              <button
                className="catalog-button small"
                type="button"
                onClick={() => copy(day)}
              >
                Copy message
              </button>
              <span aria-live="polite">
                {copiedDate === day.date ? 'Copied' : ''}
              </span>
            </section>
          ))}
        </div>
      )}
      {fallback && (
        <div className="inventory-modal-backdrop">
          <section
            className="inventory-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Copy schedule message"
          >
            <p>Clipboard access is unavailable. Copy the selected text.</p>
            <textarea ref={fallbackRef} readOnly value={fallback} rows={10} />
            <button
              className="catalog-button"
              type="button"
              onClick={() => setFallback('')}
            >
              Close
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
