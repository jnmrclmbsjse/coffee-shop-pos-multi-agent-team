import type { EmploymentType, StaffMilestone } from '@coffee-shop/shared';

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  REGULAR: 'Regular',
  PROBATIONARY: 'Probationary',
  TRAINEE: 'Trainee',
  PART_TIME: 'Part-time',
};

// Wording matches the Employment dialog's field labels and story #503.
export const MILESTONE_LABELS: Record<StaffMilestone['kind'], string> = {
  TRAINING_END: 'End of training',
  PROBATION_END: 'End of probation',
  THIRD_MONTH_REVIEW: '3rd month review',
  REGULARIZATION: 'Regularization',
};
