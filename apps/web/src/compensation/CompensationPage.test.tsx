import {
  cents,
  type PayslipSummary,
  type StaffCompensationEntry,
  type StaffMember,
} from '@coffee-shop/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompensationPage, currencyToCents } from './CompensationPage';
import { CompensationApiError } from './api';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  payslip: vi.fn(),
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
    getPayslip: api.payslip,
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
    hasAccount: false,
    accountUsername: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'staff-2',
    displayName: 'Omar Diaz',
    isActive: false,
    locationId: null,
    hasAccount: false,
    accountUsername: null,
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

const payslip: PayslipSummary = {
  staffMember: { id: 'staff-1', displayName: 'Mara Santos' },
  from: '2026-08-01',
  to: '2026-08-31',
  entries: [
    {
      id: 'payslip-entry-1',
      workDate: '2026-08-14',
      salaryCents: cents(100),
      commissionCents: cents(200),
      dailyTotalCents: cents(999),
    },
  ],
  salaryTotalCents: cents(501),
  commissionTotalCents: cents(602),
  grandTotalCents: cents(9_999),
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

  it('moves initial focus into both add and edit dialogs', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Edit Mara Santos/ });

    const { user, dialog: addDialog } = await openAddForm();
    await waitFor(() => expect(within(addDialog).getByLabelText(/Staff member/)).toHaveFocus());
    await user.click(within(addDialog).getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: /Edit Mara Santos/ }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit daily record' });
    await waitFor(() => expect(within(editDialog).getByLabelText(/Salary amount/)).toHaveFocus());
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

  it('renders payslip lines and server totals verbatim', async () => {
    api.payslip.mockResolvedValue(payslip);
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Staff member/)).toHaveValue('staff-1'),
    );
    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));

    const result = await screen.findByRole('region', {
      name: 'Payslip daily entries, horizontally scrollable',
    });
    expect(screen.getByRole('heading', { name: 'Mara Santos' })).toBeInTheDocument();
    expect(screen.getByText('Inclusive range: August 1, 2026 to August 31, 2026')).toBeInTheDocument();
    expect(within(result).getByText('August 14, 2026')).toBeInTheDocument();
    expect(within(result).getByText('₱1.00')).toBeInTheDocument();
    expect(within(result).getByText('₱2.00')).toBeInTheDocument();
    expect(within(result).getByText('₱9.99')).toBeInTheDocument();

    const totals = screen.getByRole('group', { name: 'Payslip totals' });
    expect(within(totals).getByText('₱5.01')).toBeInTheDocument();
    expect(within(totals).getByText('₱6.02')).toBeInTheDocument();
    expect(within(totals).getByText('₱99.99')).toBeInTheDocument();
  });

  it('offers a deactivated staff member when compensation history exists', async () => {
    const inactiveEntry: StaffCompensationEntry = {
      ...entry,
      id: 'entry-2',
      staffMemberId: 'staff-2',
      staffMemberDisplayName: 'Omar Diaz',
    };
    renderPage([entry, inactiveEntry]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));

    expect(
      await screen.findByRole('option', { name: 'Omar Diaz (inactive)' }),
    ).toBeInTheDocument();
  });

  it('refuses an end date before the start date without issuing a request', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Staff member/)).toHaveValue('staff-1'),
    );
    await user.clear(screen.getByLabelText('Start date'));
    await user.type(screen.getByLabelText('Start date'), '2026-08-14');
    await user.clear(screen.getByLabelText('End date'));
    await user.type(screen.getByLabelText('End date'), '2026-08-12');
    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'End date must be on or after the start date. Dates were not changed.',
    );
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-14');
    expect(screen.getByLabelText('End date')).toHaveValue('2026-08-12');
    expect(api.payslip).not.toHaveBeenCalled();
  });

  it('renders an explicit no-records result without a table or zero totals', async () => {
    api.payslip.mockResolvedValue({
      ...payslip,
      entries: [],
      salaryTotalCents: cents(0),
      commissionTotalCents: cents(0),
      grandTotalCents: cents(0),
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Staff member/)).toHaveValue('staff-1'),
    );
    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));

    expect(await screen.findByRole('heading', { name: 'No records in this range' })).toBeInTheDocument();
    expect(screen.getByText(/No payslip or totals were generated/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('₱0.00')).not.toBeInTheDocument();
  });

  it('fetches again and shows current figures when a payslip is regenerated', async () => {
    api.payslip
      .mockResolvedValueOnce(payslip)
      .mockResolvedValueOnce({
        ...payslip,
        grandTotalCents: cents(12_345),
      });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Staff member/)).toHaveValue('staff-1'),
    );
    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));
    expect(await screen.findByText('₱99.99')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));
    expect(await screen.findByText('₱123.45')).toBeInTheDocument();
    expect(api.payslip).toHaveBeenCalledTimes(2);
  });
});
