import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateStaffMemberDto,
  StaffMemberListQueryDto,
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
});
