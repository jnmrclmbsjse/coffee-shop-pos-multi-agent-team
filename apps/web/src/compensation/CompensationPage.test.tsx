import { cents, type StaffCompensationEntry, type StaffMember } from '@coffee-shop/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompensationPage, currencyToCents } from './CompensationPage';
import { CompensationApiError } from './api';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  listStaff: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    createCompensationEntry: api.create,
    deleteCompensationEntry: api.remove,
    listCompensationEntries: api.list,
    updateCompensationEntry: api.update,
  };
});

vi.mock('../staff/api', () => ({ listStaffMembers: api.listStaff }));

const staff: StaffMember[] = [
  {
    id: 'staff-1',
    displayName: 'Mara Santos',
    isActive: true,
    locationId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'staff-2',
    displayName: 'Omar Diaz',
    isActive: false,
    locationId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

const entry: StaffCompensationEntry = {
  id: 'entry-1',
  staffMemberId: 'staff-1',
  staffMemberDisplayName: 'Mara Santos',
  workDate: '2026-08-14',
  salaryCents: cents(120_000),
  commissionCents: cents(45_000),
  dailyTotalCents: cents(165_000),
  locationId: null,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
};

function renderPage(records: StaffCompensationEntry[] = [entry]) {
  api.list.mockResolvedValue(records);
  api.listStaff.mockResolvedValue(staff);
  return render(<CompensationPage />);
}

async function openAddForm() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add daily record' }));
  const dialog = screen.getByRole('dialog', { name: 'Add daily record' });
  return { user, dialog };
}

describe('currencyToCents', () => {
  it('converts entered currency exactly without floating-point arithmetic', () => {
    expect(currencyToCents('0.07', 'Salary')).toEqual({ cents: cents(7) });
    expect(currencyToCents('1200.5', 'Salary')).toEqual({ cents: cents(120_050) });
    expect(currencyToCents('1.005', 'Salary')).toEqual({
      error: 'Salary cannot have more than 2 decimal places.',
    });
  });
});

describe('CompensationPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T04:00:00.000Z'));
    Object.values(api).forEach((mock) => mock.mockReset());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the staff member, date, salary, commission, and derived total', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /Edit Mara Santos/ })).toBeInTheDocument();
    expect(screen.getByText('August 14, 2026')).toBeInTheDocument();
    expect(screen.getByText('₱1,200.00')).toBeInTheDocument();
    expect(screen.getByText('₱450.00')).toBeInTheDocument();
    expect(screen.getByText('₱1,650.00')).toBeInTheDocument();
  });

  it('blocks required, negative, and non-numeric amounts with per-field messages', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Edit Mara Santos/ });
    const { user, dialog } = await openAddForm();
    await user.selectOptions(within(dialog).getByLabelText(/Staff member/), 'staff-1');
    await user.click(within(dialog).getByRole('button', { name: 'Add record' }));

    expect(within(dialog).getAllByText('Enter a salary amount. Zero is allowed.')).toHaveLength(2);
    expect(within(dialog).getAllByText('Enter a commission amount. Zero is allowed.')).toHaveLength(2);

    await user.type(within(dialog).getByLabelText(/Salary amount/), '-1');
    await user.type(within(dialog).getByLabelText(/Commission amount/), 'not money');
    await user.click(within(dialog).getByRole('button', { name: 'Add record' }));

    expect(within(dialog).getAllByText('Salary cannot be negative.')).toHaveLength(2);
    expect(within(dialog).getAllByText('Commission must be a number.')).toHaveLength(2);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('creates once with normalized cents and shows the returned total', async () => {
    const created = {
      ...entry,
      id: 'entry-2',
      workDate: '2026-08-15',
      salaryCents: cents(7),
      commissionCents: cents(100),
      dailyTotalCents: cents(107),
    };
    api.create.mockResolvedValue(created);
    renderPage();
    await screen.findByRole('button', { name: /Edit Mara Santos/ });
    const { user, dialog } = await openAddForm();
    await user.selectOptions(within(dialog).getByLabelText(/Staff member/), 'staff-1');
    await user.type(within(dialog).getByLabelText(/Salary amount/), '0.07');
    await user.type(within(dialog).getByLabelText(/Commission amount/), '1.00');
    expect(within(dialog).getByText('₱1.07')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add record' }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith({
      staffMemberId: 'staff-1',
      workDate: '2026-08-15',
      salaryCents: cents(7),
      commissionCents: cents(100),
    });
    expect(await screen.findByText('₱1.07')).toBeInTheDocument();
  });

  it('edits amounts once and renders the updated total without a refetch', async () => {
    api.update.mockResolvedValue({
      ...entry,
      salaryCents: cents(125_000),
      dailyTotalCents: cents(170_000),
    });
    renderPage();
    await screen.findByText('₱1,650.00');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Edit Mara Santos/ }));
    const dialog = screen.getByRole('dialog', { name: 'Edit daily record' });
    const salary = within(dialog).getByLabelText(/Salary amount/);
    await user.clear(salary);
    await user.type(salary, '1250.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith('entry-1', {
      salaryCents: cents(125_000),
      commissionCents: cents(45_000),
    });
    expect(await screen.findByText('₱1,700.00')).toBeInTheDocument();
  });

  it('keeps a duplicate form populated and attributes the conflict to the staff/date pair', async () => {
    api.create.mockRejectedValue(new CompensationApiError(409, ['Duplicate entry']));
    renderPage();
    await screen.findByRole('button', { name: /Edit Mara Santos/ });
    const { user, dialog } = await openAddForm();
    await user.selectOptions(within(dialog).getByLabelText(/Staff member/), 'staff-1');
    await user.type(within(dialog).getByLabelText(/Salary amount/), '1200.00');
    await user.type(within(dialog).getByLabelText(/Commission amount/), '450.00');
    await user.click(within(dialog).getByRole('button', { name: 'Add record' }));

    expect(await within(dialog).findByText('A record already exists')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Nothing was changed. Mara Santos already has a record for August 15, 2026.');
    expect(within(dialog).getByLabelText(/Salary amount/)).toHaveValue('1200.00');
    expect(within(dialog).getByLabelText(/Commission amount/)).toHaveValue('450.00');
  });

  it('sends no request when delete is cancelled, then removes the row when confirmed', async () => {
    api.remove.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText('₱1,650.00');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Delete Mara Santos/ }));
    let dialog = screen.getByRole('dialog', { name: 'Delete daily record?' });
    expect(dialog).toHaveTextContent("Mara Santos's record for August 14, 2026");
    expect(dialog).toHaveTextContent('₱1,650.00');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Edit Mara Santos/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Delete Mara Santos/ }));
    dialog = screen.getByRole('dialog', { name: 'Delete daily record?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete record' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('entry-1'));
    expect(screen.queryByText('₱1,650.00')).not.toBeInTheDocument();
  });
});
