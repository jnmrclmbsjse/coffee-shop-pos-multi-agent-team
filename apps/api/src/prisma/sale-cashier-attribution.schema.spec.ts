import { Prisma } from '@prisma/client';

describe('Sale cashier attribution schema', () => {
  const models = Prisma.dmmf.datamodel.models;
  const sale = models.find((model) => model.name === 'Sale');
  const staffMember = models.find((model) => model.name === 'StaffMember');

  it('keeps the cashier id and historical name snapshot optional', () => {
    expect(sale?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'cashierStaffMemberId',
          type: 'String',
          isRequired: false,
        }),
        expect.objectContaining({
          name: 'cashierNameSnapshot',
          type: 'String',
          isRequired: false,
        }),
      ]),
    );
  });

  it('defines the named optional relation in both directions', () => {
    expect(sale?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'cashierStaffMember',
          type: 'StaffMember',
          isRequired: false,
          relationName: 'SaleCashier',
          relationFromFields: ['cashierStaffMemberId'],
          relationOnDelete: 'Restrict',
        }),
      ]),
    );
    expect(staffMember?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'cashierSales',
          type: 'Sale',
          isList: true,
          relationName: 'SaleCashier',
        }),
      ]),
    );
  });
});
