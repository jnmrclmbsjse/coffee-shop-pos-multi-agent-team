import {
  cents,
  CompensationAdjustmentKind,
  type PayslipSummary,
  type StaffCompensationAdjustment,
  type StaffCompensationEntry,
  type StaffMember,
} from '@coffee-shop/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompensationPage, currencyToCents } from './CompensationPage';
import { CompensationApiError } from './api';

const api = vi.hoisted(() => ({
  adjustCreate: vi.fn(),
  adjustList: vi.fn(),
  adjustRemove: vi.fn(),
  adjustUpdate: vi.fn(),
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
    createCompensationAdjustment: api.adjustCreate,
    createCompensationEntry: api.create,
    deleteCompensationAdjustment: api.adjustRemove,
    deleteCompensationEntry: api.remove,
    listCompensationAdjustments: api.adjustList,
    listCompensationEntries: api.list,
    getPayslip: api.payslip,
    updateCompensationEntry: api.update,
    updateCompensationAdjustment: api.adjustUpdate,
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

const adjustment: StaffCompensationAdjustment = {
  id: 'adjustment-1',
  staffMemberId: 'staff-1',
  staffMemberDisplayName: 'Mara Santos',
  kind: CompensationAdjustmentKind.ALLOWANCE,
  effectiveDate: '2026-08-14',
  amountCents: cents(45_000),
  description: 'Transportation allowance',
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

function renderPage(
  records: StaffCompensationEntry[] = [entry],
  adjustmentRecords: StaffCompensationAdjustment[] | null = [],
) {
  api.list.mockResolvedValue(records);
  if (adjustmentRecords !== null) api.adjustList.mockResolvedValue(adjustmentRecords);
  api.listStaff.mockResolvedValue(staff);
  return render(<CompensationPage />);
}

async function openAddForm() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add daily record' }));
  const dialog = screen.getByRole('dialog', { name: 'Add daily record' });
  return { user, dialog };
}

async function openAdjustmentForm() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Adjustments' }));
  await screen.findByRole('heading', { name: 'Adjustments' });
  await user.click(screen.getAllByRole('button', { name: /Add adjustment/ })[0]!);
  const dialog = screen.getByRole('dialog', { name: 'Add adjustment' });
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

  it.each([
    [CompensationAdjustmentKind.ADVANCE, 'Emergency cash advance'],
    [CompensationAdjustmentKind.ALLOWANCE, 'Meal allowance'],
    [CompensationAdjustmentKind.BONUS, 'Holiday bonus'],
  ])('creates a %s adjustment and updates the list without reloading', async (kind, description) => {
    const created: StaffCompensationAdjustment = {
      ...adjustment,
      id: `created-${kind}`,
      kind,
      effectiveDate: '2026-08-15',
      amountCents: cents(123_45),
      description,
    };
    api.adjustCreate.mockResolvedValue(created);
    renderPage();
    const { user, dialog } = await openAdjustmentForm();
    await within(dialog).findByRole('option', { name: 'Mara Santos' });
    await user.selectOptions(within(dialog).getByLabelText(/Staff member/), 'staff-1');
    await user.click(within(dialog).getByRole('button', {
      name: kind === CompensationAdjustmentKind.ADVANCE
        ? 'Advance'
        : kind === CompensationAdjustmentKind.ALLOWANCE ? 'Allowance' : 'Bonus',
    }));
    await user.type(within(dialog).getByLabelText('Description'), description);
    await user.type(within(dialog).getByLabelText('Amount'), '123.45');
    await user.click(within(dialog).getByRole('button', { name: 'Add adjustment' }));

    await waitFor(() => expect(api.adjustCreate).toHaveBeenCalledWith({
      staffMemberId: 'staff-1',
      kind,
      effectiveDate: '2026-08-15',
      amountCents: cents(123_45),
      description,
    }));
    expect(await screen.findByText(description)).toBeInTheDocument();
    expect(api.adjustList).toHaveBeenCalledTimes(2);
  });

  it('sends identical payloads for a preset and the same hand-typed description and permits both rows', async () => {
    api.adjustCreate
      .mockResolvedValueOnce({ ...adjustment, id: 'preset-row' })
      .mockResolvedValueOnce({ ...adjustment, id: 'typed-row' });
    renderPage();
    const { user, dialog } = await openAdjustmentForm();
    await within(dialog).findByRole('option', { name: 'Mara Santos' });
    await user.selectOptions(within(dialog).getByLabelText(/Staff member/), 'staff-1');
    await user.click(within(dialog).getByRole('button', { name: 'Transportation allowance' }));
    await user.type(within(dialog).getByLabelText('Amount'), '450.00');
    await user.click(within(dialog).getByRole('button', { name: 'Add adjustment' }));
    await waitFor(() => expect(api.adjustCreate).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /Add adjustment/ }));
    const secondDialog = screen.getByRole('dialog', { name: 'Add adjustment' });
    await user.selectOptions(within(secondDialog).getByLabelText(/Staff member/), 'staff-1');
    await user.type(within(secondDialog).getByLabelText('Description'), 'Transportation allowance');
    await user.type(within(secondDialog).getByLabelText('Amount'), '450.00');
    await user.click(within(secondDialog).getByRole('button', { name: 'Add adjustment' }));
    await waitFor(() => expect(api.adjustCreate).toHaveBeenCalledTimes(2));

    expect(api.adjustCreate.mock.calls[0]![0]).toEqual(api.adjustCreate.mock.calls[1]![0]);
    const table = screen.getByRole('region', { name: /Compensation adjustments table/ });
    expect(within(table).getAllByText('Transportation allowance')).toHaveLength(2);
    expect(screen.queryByText(/duplicate|already exists/i)).not.toBeInTheDocument();
  });

  it('preserves a custom description byte-exactly through create, list, and edit', async () => {
    const description = 'MiXeD  café allowance';
    const created = { ...adjustment, id: 'custom-row', description };
    api.adjustCreate.mockResolvedValue(created);
    api.adjustUpdate.mockResolvedValue({ ...created, amountCents: cents(50_000) });
    renderPage();
    const { user, dialog } = await openAdjustmentForm();
    await within(dialog).findByRole('option', { name: 'Mara Santos' });
    await user.selectOptions(within(dialog).getByLabelText(/Staff member/), 'staff-1');
    await user.type(within(dialog).getByLabelText('Description'), description);
    await user.type(within(dialog).getByLabelText('Amount'), '450.00');
    await user.click(within(dialog).getByRole('button', { name: 'Add adjustment' }));

    const editButton = await screen.findByRole('button', { name: /Edit MiXeD café allowance/ });
    await user.click(editButton);
    const editDialog = screen.getByRole('dialog', { name: 'Edit adjustment' });
    expect(within(editDialog).getByLabelText('Description')).toHaveValue(description);
    const amount = within(editDialog).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '500.00');
    await user.click(within(editDialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.adjustUpdate).toHaveBeenCalledWith('custom-row', {
      effectiveDate: '2026-08-14',
      amountCents: cents(50_000),
      description,
    }));
  });

  it('shows per-field errors for missing, negative, sub-centavo, non-numeric, and empty values', async () => {
    renderPage();
    const { user, dialog } = await openAdjustmentForm();
    await within(dialog).findByRole('option', { name: 'Mara Santos' });
    await user.selectOptions(within(dialog).getByLabelText(/Staff member/), 'staff-1');
    await user.click(within(dialog).getByRole('button', { name: 'Add adjustment' }));
    expect(within(dialog).getAllByText('Enter a description. Spaces alone are not accepted.')).toHaveLength(2);
    expect(within(dialog).getAllByText('Enter an amount.')).toHaveLength(2);

    const description = within(dialog).getByLabelText('Description');
    const amount = within(dialog).getByLabelText('Amount');
    await user.type(description, 'Test allowance');
    await user.type(amount, '-1');
    await user.click(within(dialog).getByRole('button', { name: 'Add adjustment' }));
    expect(within(dialog).getAllByText('Amount cannot be negative.')).toHaveLength(2);

    await user.clear(amount);
    await user.type(amount, '12.345');
    await user.click(within(dialog).getByRole('button', { name: 'Add adjustment' }));
    expect(within(dialog).getAllByText('Amount cannot have more than 2 decimal places.')).toHaveLength(2);

    await user.clear(amount);
    await user.type(amount, 'not money');
    await user.click(within(dialog).getByRole('button', { name: 'Add adjustment' }));
    expect(within(dialog).getAllByText('Amount must be a number.')).toHaveLength(2);

    await user.clear(amount);
    await user.type(amount, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Add adjustment' }));
    expect(within(dialog).getAllByText('Amount must be at least ₱0.01.')).toHaveLength(2);

    await user.clear(amount);
    await user.type(amount, '1.00');
    fireEvent.change(description, { target: { value: 'x'.repeat(121) } });
    expect(within(dialog).getByText('121 / 120')).toHaveClass('over');
    await user.click(within(dialog).getByRole('button', { name: 'Add adjustment' }));
    expect(within(dialog).getAllByText('Description must be 120 characters or fewer.')).toHaveLength(2);
    expect(api.adjustCreate).not.toHaveBeenCalled();
  });

  it('renders authoritative API field validation in the adjustment dialog', async () => {
    api.adjustCreate.mockRejectedValue(new CompensationApiError(
      400,
      ['amountCents must be at least 1'],
      'amountCents',
    ));
    renderPage();
    const { user, dialog } = await openAdjustmentForm();
    await within(dialog).findByRole('option', { name: 'Mara Santos' });
    await user.selectOptions(within(dialog).getByLabelText(/Staff member/), 'staff-1');
    await user.type(within(dialog).getByLabelText('Description'), 'Load allowance');
    await user.type(within(dialog).getByLabelText('Amount'), '1.00');
    await user.click(within(dialog).getByRole('button', { name: 'Add adjustment' }));

    expect(await within(dialog).findAllByText('Enter a valid positive amount with no more than two decimal places.')).toHaveLength(2);
    expect(within(dialog).getByLabelText('Amount')).toHaveAttribute('aria-invalid', 'true');
  });

  it('edits an adjustment and confirms permanent deletion while cancel leaves it unchanged', async () => {
    const updated = { ...adjustment, description: 'Edited allowance', amountCents: cents(50_000) };
    api.adjustUpdate.mockResolvedValue(updated);
    api.adjustRemove.mockResolvedValue(undefined);
    renderPage([entry], [adjustment]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Adjustments' }));
    await user.click(await screen.findByRole('button', { name: /Edit Transportation allowance/ }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit adjustment' });
    const description = within(editDialog).getByLabelText('Description');
    const amount = within(editDialog).getByLabelText('Amount');
    await user.clear(description);
    await user.type(description, 'Edited allowance');
    await user.clear(amount);
    await user.type(amount, '500.00');
    await user.click(within(editDialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Edited allowance')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Delete Edited allowance/ }));
    let deleteDialog = screen.getByRole('dialog', { name: 'Delete adjustment?' });
    expect(deleteDialog).toHaveTextContent('Mara Santos');
    expect(deleteDialog).toHaveTextContent('August 14, 2026');
    expect(deleteDialog).toHaveTextContent('Allowance');
    expect(deleteDialog).toHaveTextContent('Edited allowance');
    expect(deleteDialog).toHaveTextContent('₱500.00');
    expect(deleteDialog).toHaveTextContent('There is no undo');
    await user.click(within(deleteDialog).getByRole('button', { name: 'Cancel' }));
    expect(api.adjustRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Edited allowance')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Delete Edited allowance/ }));
    deleteDialog = screen.getByRole('dialog', { name: 'Delete adjustment?' });
    await user.click(within(deleteDialog).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(api.adjustRemove).toHaveBeenCalledWith('adjustment-1'));
    expect(screen.queryByRole('button', { name: /Edit Edited allowance/ })).not.toBeInTheDocument();
  });

  it('renders access denied when the adjustments API returns 403', async () => {
    api.adjustList.mockRejectedValue(new CompensationApiError(403, ['Forbidden']));
    renderPage([entry], null);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Adjustments' }));

    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.getByText('You do not have permission to view staff compensation adjustments.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Compensation adjustments/ })).not.toBeInTheDocument();
  });
});
