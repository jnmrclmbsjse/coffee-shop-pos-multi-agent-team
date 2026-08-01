import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Cashier selection schema', () => {
  const models = Prisma.dmmf.datamodel.models;
  const user = models.find((model) => model.name === 'User');
  const staffMember = models.find((model) => model.name === 'StaffMember');
  const cashierSelection = models.find(
    (model) => model.name === 'CashierSelection',
  );

  it('links at most one roster member to an auth account without duplicating the PIN', () => {
    expect(staffMember?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'userId',
          type: 'String',
          isRequired: false,
          isUnique: true,
        }),
        expect.objectContaining({
          name: 'user',
          type: 'User',
          isRequired: false,
          relationFromFields: ['userId'],
          relationOnDelete: 'Restrict',
        }),
      ]),
    );
    expect(staffMember?.fields.some((field) => field.name === 'pinHash')).toBe(
      false,
    );
    expect(user?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'staffMember',
          type: 'StaffMember',
          isRequired: false,
          isList: false,
        }),
      ]),
    );
  });

  it('defines an append-only selection record whose nullable staff member can represent clearing', () => {
    expect(cashierSelection?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'deviceId',
          type: 'String',
          isRequired: true,
        }),
        expect.objectContaining({
          name: 'locationId',
          type: 'String',
          isRequired: false,
        }),
        expect.objectContaining({
          name: 'staffMemberId',
          type: 'String',
          isRequired: false,
        }),
        expect.objectContaining({
          name: 'selectedByUserId',
          type: 'String',
          isRequired: true,
        }),
        expect.objectContaining({
          name: 'selectedAt',
          type: 'DateTime',
          isRequired: true,
          hasDefaultValue: true,
        }),
      ]),
    );
  });

  it('restricts deletion of every record referenced by selection history', () => {
    expect(cashierSelection?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'location',
          relationFromFields: ['locationId'],
          relationOnDelete: 'Restrict',
        }),
        expect.objectContaining({
          name: 'staffMember',
          relationFromFields: ['staffMemberId'],
          relationOnDelete: 'Restrict',
        }),
        expect.objectContaining({
          name: 'selectedByUser',
          relationFromFields: ['selectedByUserId'],
          relationOnDelete: 'Restrict',
        }),
      ]),
    );
  });

  it('indexes selections by device and selection time for current-cashier reads', () => {
    const schema = readFileSync(
      resolve(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    const model = schema.match(/model CashierSelection \{[\s\S]*?\n\}/)?.[0];

    expect(model).toContain('@@index([deviceId, selectedAt])');
  });
});
