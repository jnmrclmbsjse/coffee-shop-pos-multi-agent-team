import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateStaffAccountDto,
  CreateStaffMemberDto,
  StaffMemberListQueryDto,
  UpdateStaffCredentialsDto,
  UpdateStaffMemberDto,
} from './staff.dto';

describe('Staff DTO validation', () => {
  it('trims the required name and defaults new staff to active', async () => {
    const input = plainToInstance(CreateStaffMemberDto, {
      displayName: '  Alex Rivera  ',
    });

    expect(await validate(input)).toHaveLength(0);
    expect(input).toMatchObject({
      displayName: 'Alex Rivera',
      isActive: true,
    });
  });

  it.each([
    {},
    { displayName: '' },
    { displayName: '   ' },
  ])('rejects a missing or blank create name: %j', async (value) => {
    const input = plainToInstance(CreateStaffMemberDto, value);

    expect(await validate(input)).not.toHaveLength(0);
  });

  it('rejects a whitespace-only name when editing', async () => {
    const input = plainToInstance(UpdateStaffMemberDto, {
      displayName: '   ',
    });

    expect(await validate(input)).not.toHaveLength(0);
  });

  it('transforms list filters and applies first-load sort defaults', async () => {
    const query = plainToInstance(StaffMemberListQueryDto, {
      search: '  aLeX ',
      active: 'false',
    });

    expect(await validate(query)).toHaveLength(0);
    expect(query).toEqual({
      search: 'aLeX',
      active: false,
      sort: 'name',
      direction: 'asc',
    });
  });

  it('normalizes account fields without changing the password', async () => {
    const input = plainToInstance(CreateStaffAccountDto, {
      username: '  Jane.Santos  ',
      displayName: '  Jane Santos  ',
      password: ' Exact Password ',
      pin: '4826',
    });

    expect(await validate(input)).toHaveLength(0);
    expect(input).toEqual({
      username: 'Jane.Santos',
      displayName: 'Jane Santos',
      password: ' Exact Password ',
      pin: '4826',
    });
  });

  it.each([
    [{ password: 'secret' }, 'username'],
    [{ username: '   ', password: 'secret' }, 'username'],
    [{ username: 'jane' }, 'password'],
    [{ username: 'jane', password: '' }, 'password'],
    [{ username: 'jane', password: 'secret', pin: '123' }, 'pin'],
    [{ username: 'jane', password: 'secret', pin: '12345' }, 'pin'],
    [{ username: 'jane', password: 'secret', pin: '12a4' }, 'pin'],
    [{ username: 'jane', password: 'secret', pin: null }, 'pin'],
    [
      { username: 'jane', password: 'secret', displayName: null },
      'displayName',
    ],
  ])('rejects invalid account input %j on %s', async (value, field) => {
    const input = plainToInstance(CreateStaffAccountDto, value);
    const errors = await validate(input);

    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('allows an omitted PIN and a password made only of spaces', async () => {
    const input = plainToInstance(CreateStaffAccountDto, {
      username: 'jane',
      password: '   ',
    });

    expect(await validate(input)).toHaveLength(0);
    expect(input.password).toBe('   ');
    expect(input.pin).toBeUndefined();
  });

  it.each([
    { password: ' Exact Password ' },
    { pin: '4826' },
    { password: '   ', pin: '4826' },
  ])('accepts credential rotation input %j without trimming', async (value) => {
    const input = plainToInstance(UpdateStaffCredentialsDto, value);

    expect(await validate(input)).toHaveLength(0);
    expect(input).toMatchObject(value);
  });

  it.each([
    [{ password: '' }, 'password'],
    [{ password: null }, 'password'],
    [{ pin: '123' }, 'pin'],
    [{ pin: '12345' }, 'pin'],
    [{ pin: '12a4' }, 'pin'],
    [{ pin: null }, 'pin'],
  ])('rejects invalid credential rotation input %j on %s', async (value, field) => {
    const input = plainToInstance(UpdateStaffCredentialsDto, value);
    const errors = await validate(input);

    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('rejects an update with neither credential using a form-level message', async () => {
    const input = plainToInstance(UpdateStaffCredentialsDto, {});
    const errors = await validate(input);

    expect(errors).toEqual([
      expect.objectContaining({
        property: 'credentialSelection',
        constraints: {
          hasReplacementCredential: 'Provide a new password or PIN',
        },
      }),
    ]);
  });
});
