import {
  EmploymentType,
  type StaffEmploymentDetails,
  type StaffMember,
} from '@coffee-shop/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmploymentDetailsDialog } from './EmploymentDetailsDialog';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  reveal: vi.fn(),
  rates: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getStaffEmployment: api.get,
  revealStaffGovernmentIds: api.reveal,
}));
vi.mock('../compensation/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../compensation/api')>()),
  listStaffCommissionRates: api.rates,
}));

const member: StaffMember = {
  id: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
  displayName: 'Anna Cruz',
  isActive: true,
  baseSalaryCents: null,
  locationId: null,
  hasAccount: false,
  accountUsername: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  employmentType: EmploymentType.REGULAR,
  nextMilestone: null,
};

const details: StaffEmploymentDetails = {
  staffMemberId: member.id,
  startDate: null,
  trainingEndDate: null,
  probationEndDate: null,
  thirdMonthReviewDate: null,
  regularizationDate: null,
  employmentType: EmploymentType.REGULAR,
  endDate: null,
  separationReason: null,
  birthDate: null,
  contactNumber: null,
  emergencyContactName: null,
  emergencyContactNumber: null,
  governmentIds: {
    sssNumber: { isSet: true, last4: '7890' },
    philhealthNumber: { isSet: false, last4: null },
    pagibigNumber: { isSet: false, last4: null },
    tinNumber: { isSet: false, last4: null },
  },
  typeHistory: [],
  customFields: [],
};

describe('EmploymentDetailsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(details);
    api.rates.mockResolvedValue([]);
    api.reveal.mockResolvedValue({
      sssNumber: '1234567890',
      philhealthNumber: null,
      pagibigNumber: null,
      tinNumber: null,
    });
  });

  it('keeps government IDs masked until Show explicitly reveals them', async () => {
    render(
      <EmploymentDetailsDialog
        member={member}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(await screen.findByDisplayValue('•••• 7890')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('1234567890')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() =>
      expect(screen.getByDisplayValue('1234567890')).toBeInTheDocument(),
    );
    expect(api.reveal).toHaveBeenCalledWith(member.id);
  });
});
