import { validate } from 'class-validator';
import { ReportingRangeQueryDto } from './reporting.dto';

describe('ReportingRangeQueryDto', () => {
  async function messages(input: Partial<ReportingRangeQueryDto>) {
    const dto = Object.assign(new ReportingRangeQueryDto(), input);
    const errors = await validate(dto);
    return errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
  }

  it('accepts required ISO calendar dates', async () => {
    await expect(
      messages({ from: '2026-07-01', to: '2026-07-31' }),
    ).resolves.toEqual([]);
  });

  it('returns usable messages for missing and malformed values', async () => {
    await expect(messages({ to: '2026-07-31' })).resolves.toContain(
      'from is required',
    );
    await expect(
      messages({ from: 'not-a-date', to: '2026-07-31' }),
    ).resolves.toContain('from must be a valid date');
  });
});
