import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Compensation adjustment schema', () => {
  const models = Prisma.dmmf.datamodel.models;
  const adjustment = models.find(
    (model) => model.name === 'StaffCompensationAdjustment',
  );

  it('defines the three adjustment kinds and required financial fields', () => {
    const kind = Prisma.dmmf.datamodel.enums.find(
      (entry) => entry.name === 'CompensationAdjustmentKind',
    );

    expect(kind?.values.map((value) => value.name)).toEqual([
      'ADVANCE',
      'ALLOWANCE',
      'BONUS',
    ]);
    expect(adjustment?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'staffMemberId',
          type: 'String',
          isRequired: true,
        }),
        expect.objectContaining({
          name: 'effectiveDate',
          type: 'DateTime',
          isRequired: true,
        }),
        expect.objectContaining({
          name: 'amountCents',
          type: 'Int',
          isRequired: true,
        }),
        expect.objectContaining({
          name: 'description',
          type: 'String',
          isRequired: true,
        }),
        expect.objectContaining({
          name: 'locationId',
          type: 'String',
          isRequired: false,
        }),
      ]),
    );
  });

  it('restricts deletion of every referenced record', () => {
    expect(adjustment?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'staffMember',
          relationFromFields: ['staffMemberId'],
          relationOnDelete: 'Restrict',
        }),
        expect.objectContaining({
          name: 'location',
          relationFromFields: ['locationId'],
          relationOnDelete: 'Restrict',
        }),
        expect.objectContaining({
          name: 'createdByUser',
          relationFromFields: ['createdByUserId'],
          relationOnDelete: 'Restrict',
        }),
        expect.objectContaining({
          name: 'updatedByUser',
          relationFromFields: ['updatedByUserId'],
          relationOnDelete: 'Restrict',
        }),
      ]),
    );
  });

  it('indexes staff and effective date without suppressing duplicates', () => {
    const schema = readFileSync(
      resolve(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    const model = schema.match(
      /model StaffCompensationAdjustment \{[\s\S]*?\n\}/,
    )?.[0];

    expect(model).toContain('@@index([staffMemberId, effectiveDate])');
    expect(model).not.toContain('@@unique');
  });

  it('ships the positive amount invariant in the SQL migration', () => {
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../prisma/migrations/20260822000000_add_staff_compensation_adjustments/migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain(
      'CONSTRAINT "staff_compensation_adjustments_positive_amount_check"',
    );
    expect(migration).toContain('CHECK ("amount_cents" >= 1)');
  });
});
