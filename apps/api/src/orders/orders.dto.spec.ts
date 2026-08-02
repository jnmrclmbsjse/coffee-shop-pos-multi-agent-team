import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LinePreference } from '@prisma/client';
import { CreateOrderDto, UpdateOrderLineDto, VoidOrderDto } from './orders.dto';

describe('orders DTOs', () => {
  const validCreate = {
    clientGeneratedId: '10000000-0000-4000-8000-000000000001',
    deviceId: 'register-1',
    productVariantId: '20000000-0000-4000-8000-000000000001',
  };

  it('defaults the initial order and line to the uncustomized state', async () => {
    const input = plainToInstance(CreateOrderDto, validCreate);
    await expect(validate(input)).resolves.toEqual([]);
    expect(input).toEqual(
      expect.objectContaining({
        quantity: 1,
        preferences: [],
        freeUpsizeCount: 0,
      }),
    );
  });

  it('trims notes, stores whitespace-only notes as null, and allows 255 characters', async () => {
    const exactLimit = 'x'.repeat(255);
    const input = plainToInstance(UpdateOrderLineDto, {
      preferenceNote: `  ${exactLimit}  `,
      preferences: [LinePreference.SWEETER, LinePreference.LESS_SWEET],
    });
    await expect(validate(input)).resolves.toEqual([]);
    expect(input.preferenceNote).toBe(exactLimit);

    const blank = plainToInstance(UpdateOrderLineDto, {
      preferenceNote: '   ',
    });
    await expect(validate(blank)).resolves.toEqual([]);
    expect(blank.preferenceNote).toBeNull();
  });

  it('rejects a preference note over 255 characters', async () => {
    const errors = await validate(
      plainToInstance(UpdateOrderLineDto, {
        preferenceNote: 'x'.repeat(256),
      }),
    );
    expect(errors[0]?.constraints?.maxLength).toContain('255');
  });

  it('requires a trimmed non-blank void reason', async () => {
    const input = plainToInstance(VoidOrderDto, {
      clientGeneratedId: '30000000-0000-4000-8000-000000000001',
      deviceId: 'register-1',
      voidReason: '   ',
    });
    await expect(validate(input)).resolves.not.toEqual([]);
  });
});
