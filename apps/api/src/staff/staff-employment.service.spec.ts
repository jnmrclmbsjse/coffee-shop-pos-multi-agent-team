import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  EmploymentType,
  SeparationReason,
  StaffCustomFieldType,
} from '@coffee-shop/shared';
import { Prisma } from '@prisma/client';
import { StaffEmploymentService } from './staff-employment.service';

describe('StaffEmploymentService', () => {
  const staffId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  const userId = '44fc441b-a59f-45c3-b7ae-7ea93d1b06d3';
  function setup(
    profile: Record<string, unknown> | null = null,
    mockGet = true,
  ) {
    const tx = {
      staffEmploymentProfile: { upsert: jest.fn() },
      staffEmploymentTypeChange: { create: jest.fn() },
    };
    const prisma = {
      staffMember: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: staffId, locationId: null }),
      },
      staffEmploymentProfile: {
        findUnique: jest.fn().mockResolvedValue(profile),
      },
      staffEmploymentTypeChange: { findMany: jest.fn().mockResolvedValue([]) },
      staffCustomFieldDefinition: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
      },
      staffCustomFieldValue: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
      $transaction: jest.fn(
        async (value: ((client: typeof tx) => unknown) | Promise<unknown>[]) =>
          Array.isArray(value) ? Promise.all(value) : value(tx),
      ),
    };
    const service = new StaffEmploymentService(prisma as never);
    if (mockGet) jest.spyOn(service, 'get').mockResolvedValue({} as never);
    return { service, prisma, tx };
  }
  it('normalizes government IDs and writes the first type change in the same transaction', async () => {
    const { service, prisma, tx } = setup();
    await service.update(
      staffId,
      {
        employmentType: EmploymentType.TRAINEE,
        employmentTypeEffectiveDate: '2026-10-25',
        sssNumber: '12-345 67890',
      },
      userId,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.staffEmploymentProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sssNumber: '1234567890' }),
      }),
    );
    expect(tx.staffEmploymentTypeChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employmentType: EmploymentType.TRAINEE,
        effectiveDate: new Date('2026-10-25T00:00:00Z'),
      }),
    });
  });
  it('masks government IDs by default and reveals them only from the explicit method', async () => {
    const profile = {
      sssNumber: '1234567890',
      philhealthNumber: '123456789012',
      pagibigNumber: null,
      tinNumber: '123456789',
    };
    const { service, prisma } = setup(profile, false);
    prisma.staffEmploymentProfile.findUnique
      .mockResolvedValueOnce(profile)
      .mockResolvedValueOnce(profile);

    await expect(service.get(staffId)).resolves.toMatchObject({
      governmentIds: {
        sssNumber: { isSet: true, last4: '7890' },
        philhealthNumber: { isSet: true, last4: '9012' },
        pagibigNumber: { isSet: false, last4: null },
        tinNumber: { isSet: true, last4: '6789' },
      },
    });
    await expect(service.reveal(staffId)).resolves.toEqual(profile);
  });
  it.each([
    { sssNumber: '123' },
    { philhealthNumber: '12345678901' },
    { pagibigNumber: 'abcdefghijkl' },
    { tinNumber: '12345678' },
  ])('refuses invalid ID lengths %#', async (input) => {
    const { service } = setup();
    await expect(service.update(staffId, input, userId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('does not write history when type is unchanged', async () => {
    const { service, tx } = setup({
      employmentType: 'REGULAR',
      endDate: null,
      separationReason: null,
    });
    await service.update(
      staffId,
      { employmentType: EmploymentType.REGULAR },
      userId,
    );
    expect(tx.staffEmploymentTypeChange.create).not.toHaveBeenCalled();
  });
  it('refuses clearing a set type', async () => {
    const { service } = setup({ employmentType: 'REGULAR' });
    await expect(
      service.update(staffId, { employmentType: null }, userId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ reason: 'EMPLOYMENT_TYPE_REQUIRED' }),
    });
  });
  it.each([
    { endDate: '2026-10-25' },
    { separationReason: SeparationReason.RESIGNED },
  ])('requires end date and reason together %#', async (input) => {
    const { service } = setup();
    await expect(service.update(staffId, input, userId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('locks a custom field type after a value exists', async () => {
    const { service, prisma } = setup();
    prisma.staffCustomFieldDefinition.findUnique.mockResolvedValue({
      id: 'field',
      label: 'Old',
      fieldType: 'TEXT',
      choices: [],
      sortOrder: 0,
      isArchived: false,
      _count: { values: 1 },
    });
    await expect(
      service.updateDefinition('field', {
        fieldType: StaffCustomFieldType.DATE,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it.each([
    [StaffCustomFieldType.TEXT, [], 'x'.repeat(501)],
    [StaffCustomFieldType.DATE, [], '2026-02-30'],
    [StaffCustomFieldType.NUMBER, [], '1,000'],
    [StaffCustomFieldType.CHOICE, ['A'], 'B'],
  ])('validates %s custom field values', async (fieldType, choices, value) => {
    const { service, prisma } = setup();
    prisma.staffCustomFieldDefinition.findMany.mockResolvedValue([
      { id: '9e55c455-879c-4ea8-8365-433e0e2cf4a4', fieldType, choices },
    ]);
    await expect(
      service.saveValues(
        staffId,
        {
          values: [
            { definitionId: '9e55c455-879c-4ea8-8365-433e0e2cf4a4', value },
          ],
        },
        userId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('archives a definition without deleting its values', async () => {
    const { service, prisma } = setup();
    prisma.staffCustomFieldDefinition.findUnique.mockResolvedValue({
      id: 'field',
      label: 'Uniform',
      fieldType: 'TEXT',
      choices: [],
      sortOrder: 0,
      isArchived: false,
      _count: { values: 2 },
    });
    prisma.staffCustomFieldDefinition.update.mockResolvedValue({
      id: 'field',
      label: 'Uniform',
      fieldType: 'TEXT',
      choices: [],
      sortOrder: 0,
      isArchived: true,
    });
    await expect(
      service.updateDefinition('field', { isArchived: true }),
    ).resolves.toMatchObject({ isArchived: true, hasValues: true });
    expect(prisma.staffCustomFieldValue.deleteMany).not.toHaveBeenCalled();
  });
  it('maps active label uniqueness to a conflict', async () => {
    const { service, prisma } = setup();
    prisma.staffCustomFieldDefinition.aggregate.mockResolvedValue({
      _max: { sortOrder: 0 },
    });
    prisma.staffCustomFieldDefinition.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.0',
      }),
    );
    await expect(
      service.createDefinition({
        label: ' Uniform ',
        fieldType: StaffCustomFieldType.TEXT,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        reason: 'CUSTOM_FIELD_LABEL_EXISTS',
      }),
    });
  });

  it('keeps a saved value whose choice option was removed, but refuses a new invalid one', async () => {
    const { service, prisma } = setup();
    const definitionId = '0b8f7b7e-3f43-4d4e-9b4c-6d1c2a8f9e10';
    prisma.staffCustomFieldDefinition.findMany.mockResolvedValue([
      {
        id: definitionId,
        label: 'Shirt size',
        fieldType: 'CHOICE',
        choices: ['S', 'M'],
        sortOrder: 0,
        isArchived: false,
      },
    ]);
    prisma.staffCustomFieldValue.findMany.mockResolvedValue([
      { definitionId, value: 'XL' },
    ]);

    await service.saveValues(
      staffId,
      { values: [{ definitionId, value: 'XL' }] },
      userId,
    );
    expect(prisma.staffCustomFieldValue.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: 'XL', updatedByUserId: userId },
      }),
    );

    await expect(
      service.saveValues(
        staffId,
        { values: [{ definitionId, value: 'XXL' }] },
        userId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a reorder that names an unknown or repeated field', async () => {
    const { service, prisma } = setup();
    const id = '0b8f7b7e-3f43-4d4e-9b4c-6d1c2a8f9e10';
    Object.assign(prisma.staffCustomFieldDefinition, {
      count: jest.fn().mockResolvedValue(1),
    });
    await expect(service.reorder([id, id])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.reorder([id, '7c1f3a5e-2b4d-4e6f-8a9b-0c1d2e3f4a5b']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
