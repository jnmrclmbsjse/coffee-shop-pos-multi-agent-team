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
import { payslipFilename } from './PayslipView';
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

const image = vi.hoisted(() => ({ toPng: vi.fn() }));

vi.mock('html-to-image', () => ({ toPng: image.toPng }));

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

const bonus: StaffCompensationAdjustment = {
  ...adjustment,
  id: 'adjustment-bonus',
  kind: CompensationAdjustmentKind.BONUS,
  effectiveDate: '2026-08-20',
  amountCents: cents(2_000),
  description: 'Launch weekend bonus',
};

const advance: StaffCompensationAdjustment = {
  ...adjustment,
  id: 'adjustment-advance',
  kind: CompensationAdjustmentKind.ADVANCE,
  effectiveDate: '2026-08-22',
  amountCents: cents(20_000),
  description: 'Emergency cash advance',
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
  adjustments: [],
  salaryTotalCents: cents(501),
  commissionTotalCents: cents(602),
  grandTotalCents: cents(9_999),
  allowanceTotalCents: cents(0),
  bonusTotalCents: cents(0),
  advanceTotalCents: cents(0),
  earningsTotalCents: cents(9_999),
  netPayableCents: cents(9_999),
};

const adjustedPayslip: PayslipSummary = {
  ...payslip,
  adjustments: [adjustment, bonus, advance],
  salaryTotalCents: cents(500),
  commissionTotalCents: cents(600),
  grandTotalCents: cents(1_100),
  allowanceTotalCents: cents(45_000),
  bonusTotalCents: cents(2_000),
  advanceTotalCents: cents(20_000),
  earningsTotalCents: cents(12_345),
  netPayableCents: cents(-7_655),
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

describe('payslipFilename', () => {
  it('creates a deterministic filename-safe staff slug', () => {
    expect(payslipFilename('  Mara D. Santos  ', '2026-08-01', '2026-08-31'))
      .toBe('payslip-mara-d-santos-2026-08-01-2026-08-31.png');
  });
});

describe('CompensationPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T04:00:00.000Z'));
    Object.values(api).forEach((mock) => mock.mockReset());
    image.toPng.mockReset();
    image.toPng.mockResolvedValue('data:image/png;base64,payslip');
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

  it('itemizes earnings and advances and renders every server total verbatim', async () => {
    api.payslip.mockResolvedValue(adjustedPayslip);
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Staff member/)).toHaveValue('staff-1'),
    );
    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));

    const artifact = await screen.findByRole('article', { name: 'Mara Santos' });
    expect(within(artifact).getByText('Inclusive range: August 1, 2026 to August 31, 2026')).toBeInTheDocument();
    expect(within(artifact).getByText('Transportation allowance')).toBeInTheDocument();
    expect(within(artifact).getByText('Launch weekend bonus')).toBeInTheDocument();
    expect(within(artifact).getByText('Emergency cash advance')).toBeInTheDocument();

    const earnings = within(artifact).getByLabelText('Earnings totals');
    expect(earnings).toHaveTextContent('Salary total₱5.00');
    expect(earnings).toHaveTextContent('Commission total₱6.00');
    expect(earnings).toHaveTextContent('Allowance total₱450.00');
    expect(earnings).toHaveTextContent('Bonus total₱20.00');
    expect(earnings).toHaveTextContent('Earnings total₱123.45');
    expect(within(artifact).getByLabelText('Deduction totals')).toHaveTextContent('Advance total−₱200.00');
    expect(within(artifact).getByText('₱-76.55')).toBeInTheDocument();
    expect(within(artifact).getByText(/Advances in this range exceed earnings/)).toBeInTheDocument();
    expect(within(artifact).getByText(/^Generated .*2026/)).toBeInTheDocument();
  });

  it('itemizes every daily salary and commission entry with its server total', async () => {
    api.payslip.mockResolvedValue({
      ...adjustedPayslip,
      entries: [
        payslip.entries[0]!,
        {
          id: 'payslip-entry-2',
          workDate: '2026-08-18',
          salaryCents: cents(123_456),
          commissionCents: cents(7),
          dailyTotalCents: cents(123_463),
        },
        {
          id: 'payslip-entry-3',
          workDate: '2026-08-22',
          salaryCents: cents(0),
          commissionCents: cents(1),
          dailyTotalCents: cents(1),
        },
      ],
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Staff member/)).toHaveValue('staff-1'),
    );
    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));

    const dailyTable = await screen.findByRole('table', {
      name: 'Daily salary and commission entries included in this payslip',
    });
    const rows = within(dailyTable).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('August 14, 2026₱1.00₱2.00₱9.99');
    expect(rows[1]).toHaveTextContent(
      'August 18, 2026₱1,234.56₱0.07₱1,234.63',
    );
    expect(rows[2]).toHaveTextContent('August 22, 2026₱0.00₱0.01₱0.01');
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
    expect(screen.queryByRole('button', { name: 'Download PNG' })).not.toBeInTheDocument();
  });

  it('fetches again and shows current server figures when a payslip is regenerated', async () => {
    api.payslip
      .mockResolvedValueOnce(payslip)
      .mockResolvedValueOnce({
        ...payslip,
        earningsTotalCents: cents(12_345),
        netPayableCents: cents(8_765),
      });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Staff member/)).toHaveValue('staff-1'),
    );
    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));
    expect((await screen.findAllByText('₱99.99')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));
    expect(await screen.findByText('₱123.45')).toBeInTheDocument();
    expect(await screen.findByText('₱87.65')).toBeInTheDocument();
    expect(api.payslip).toHaveBeenCalledTimes(2);
  });

  it('treats an adjustment-only range as downloadable instead of empty', async () => {
    api.payslip.mockResolvedValue({
      ...adjustedPayslip,
      entries: [],
      adjustments: [advance],
      salaryTotalCents: cents(0),
      commissionTotalCents: cents(0),
      grandTotalCents: cents(0),
      allowanceTotalCents: cents(0),
      bonusTotalCents: cents(0),
      earningsTotalCents: cents(0),
      advanceTotalCents: cents(20_000),
      netPayableCents: cents(-20_000),
    });
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));
    await waitFor(() => expect(screen.getByLabelText(/Staff member/)).toHaveValue('staff-1'));
    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));

    expect(await screen.findByText('Emergency cash advance')).toBeInTheDocument();
    expect(screen.getByText('₱-200.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No records in this range' })).not.toBeInTheDocument();
  });

  it('captures the rendered artifact and downloads it with the deterministic filename', async () => {
    api.payslip.mockResolvedValue(adjustedPayslip);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));
    await waitFor(() => expect(screen.getByLabelText(/Staff member/)).toHaveValue('staff-1'));
    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));
    await user.click(await screen.findByRole('button', { name: 'Download PNG' }));

    await waitFor(() => expect(image.toPng).toHaveBeenCalledTimes(1));
    const capturedNode = image.toPng.mock.calls[0]![0] as HTMLElement;
    expect(capturedNode).toHaveAttribute('id', 'payslip-capture-node');
    expect(capturedNode).toHaveTextContent('Mara Santos');
    expect(capturedNode).toHaveTextContent('Inclusive range: August 1, 2026 to August 31, 2026');
    expect(capturedNode).toHaveTextContent('Daily salary and commission');
    expect(capturedNode).toHaveTextContent('August 14, 2026');
    expect(capturedNode).toHaveTextContent('₱9.99');
    expect(capturedNode).toHaveTextContent('Transportation allowance');
    expect(capturedNode).toHaveTextContent('Launch weekend bonus');
    expect(capturedNode).toHaveTextContent('Emergency cash advance');
    expect(capturedNode).toHaveTextContent('Net payable');
    expect(capturedNode).toHaveTextContent('Generated');
    const options = image.toPng.mock.calls[0]![1] as {
      filter?: (node: Node) => boolean;
    };
    const filter = options.filter;
    const textNode = document
      .createTreeWalker(capturedNode, NodeFilter.SHOW_TEXT)
      .nextNode();
    const excludedButton = within(capturedNode).getByRole('button', {
      name: 'Download PNG',
    });
    expect(filter).toBeDefined();
    expect(textNode).not.toBeNull();
    expect(filter!(textNode!)).toBe(true);
    expect(filter!(excludedButton)).toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe('payslip-mara-santos-2026-08-01-2026-08-31.png');
    expect(link.href).toBe('data:image/png;base64,payslip');
    expect(await screen.findByRole('status')).toHaveTextContent('Downloaded: payslip-mara-santos-2026-08-01-2026-08-31.png');
  });

  it('surfaces rasterization failure and offers a retry without removing the payslip', async () => {
    image.toPng.mockRejectedValue(new Error('canvas failed'));
    api.payslip.mockResolvedValue(adjustedPayslip);
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payslips' }));
    await waitFor(() => expect(screen.getByLabelText(/Staff member/)).toHaveValue('staff-1'));
    await user.click(screen.getByRole('button', { name: 'Generate payslip' }));
    await user.click(await screen.findByRole('button', { name: 'Download PNG' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Image could not be prepared.');
    expect(alert).toHaveTextContent('The on-screen payslip is unchanged.');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Mara Santos' })).toBeInTheDocument();
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
