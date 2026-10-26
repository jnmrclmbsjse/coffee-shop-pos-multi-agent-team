import type { SaveScheduleWeekInput, ScheduleWeekView } from '@coffee-shop/shared';
import { sessionFetch } from '../auth/session-fetch';
async function request<T>(path: string, init?: RequestInit): Promise<T> { const response = await sessionFetch(path, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers } }); if (!response.ok) { const body = await response.json().catch(() => ({})) as { message?: string }; throw new Error(body.message ?? 'Schedule request failed'); } return response.json() as Promise<T>; }
export function getScheduleWeek(weekStart: string): Promise<ScheduleWeekView> { return request(`/scheduling/weeks/${weekStart}`); }
export function saveScheduleWeek(weekStart: string, input: SaveScheduleWeekInput): Promise<ScheduleWeekView> { return request(`/scheduling/weeks/${weekStart}`, { method: 'PUT', body: JSON.stringify(input) }); }
