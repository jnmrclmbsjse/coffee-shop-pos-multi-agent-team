import { BadRequestException } from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type { Response } from 'express';
import {
  AUTH_COOKIE_MAX_AGE_MS,
  AUTH_COOKIE_NAME,
  DEVICE_ID_REQUIRED_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
  USERNAME_REQUIRED_MESSAGE,
} from './auth.constants';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

describe('AuthController', () => {
  const login = jest.fn().mockResolvedValue({
    response: {
      user: {
        id: 'user-id',
        username: 'admin',
        role: 'ADMIN',
      },
    },
    token: 'signed-token',
  });
  const staffPasswordLogin = jest.fn().mockResolvedValue({
    response: {
      user: {
        id: 'staff-id',
        username: 'staff',
        displayName: 'Casey Barista',
        role: Role.STAFF,
      },
    },
    token: 'staff-token',
  });
  const staffPinLogin = jest.fn().mockResolvedValue({
    response: {
      user: {
        id: 'staff-id',
        username: 'staff',
        displayName: 'Casey Barista',
        role: Role.STAFF,
      },
    },
    token: 'staff-token',
  });
  const authService = {
    login,
    staffPasswordLogin,
    staffPinLogin,
  } as unknown as AuthService;
  const cookie = jest.fn();
  const response = { cookie } as unknown as Response;
  const controller = new AuthController(authService);

  beforeEach(() => {
    login.mockClear();
    staffPasswordLogin.mockClear();
    staffPinLogin.mockClear();
    cookie.mockClear();
    delete process.env.AUTH_COOKIE_SECURE;
    delete process.env.AUTH_COOKIE_SAME_SITE;
  });

  it('returns the authenticated administrator from the verified session', () => {
    expect(
      controller.session({
        headers: {},
        user: {
          id: 'user-id',
          username: 'admin',
          role: Role.ADMIN,
        },
      }),
    ).toEqual({
      user: {
        id: 'user-id',
        username: 'admin',
        role: Role.ADMIN,
      },
    });
  });

  it('returns an authenticated staff session with its display name', () => {
    expect(
      controller.session({
        headers: {},
        user: {
          id: 'staff-id',
          username: 'staff',
          displayName: 'Casey Barista',
          role: Role.STAFF,
        },
      }),
    ).toEqual({
      user: {
        id: 'staff-id',
        username: 'staff',
        displayName: 'Casey Barista',
        role: Role.STAFF,
      },
    });
  });

  it('sets a persistent httpOnly secure cookie after login', async () => {
    const result = await controller.login(
      { username: ' admin ', password: ' exact password ' },
      response,
    );

    expect(login).toHaveBeenCalledWith(' admin ', ' exact password ');
    expect(cookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, 'signed-token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: AUTH_COOKIE_MAX_AGE_MS,
      path: '/',
    });
    expect(result).toEqual({
      user: {
        id: 'user-id',
        username: 'admin',
        role: 'ADMIN',
      },
    });
  });

  it.each([undefined, null, {}, { username: '   ', password: 'password' }])(
    'rejects a missing or all-space username',
    async (body) => {
      await expect(controller.login(body, response)).rejects.toEqual(
        new BadRequestException(USERNAME_REQUIRED_MESSAGE),
      );
      expect(login).not.toHaveBeenCalled();
    },
  );

  it.each([
    { username: 'admin' },
    { username: 'admin', password: '' },
  ])('rejects a missing password', async (body) => {
    await expect(controller.login(body, response)).rejects.toEqual(
      new BadRequestException(PASSWORD_REQUIRED_MESSAGE),
    );
    expect(login).not.toHaveBeenCalled();
  });

  it('does not trim password spaces', async () => {
    await controller.login({ username: 'admin', password: '   ' }, response);

    expect(login).toHaveBeenCalledWith('admin', '   ');
  });

  it('forces Secure when cross-site cookies are enabled', async () => {
    process.env.AUTH_COOKIE_SECURE = 'false';
    process.env.AUTH_COOKIE_SAME_SITE = 'none';

    await controller.login(
      { username: 'admin', password: 'password' },
      response,
    );

    expect(cookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      'signed-token',
      expect.objectContaining({
        secure: true,
        sameSite: 'none',
      }),
    );
  });

  it('sets the shared session cookie after staff password login', async () => {
    const result = await controller.staffPasswordLogin(
      {
        username: ' staff ',
        password: ' exact password ',
        deviceId: 'device-1',
      },
      response,
    );

    expect(staffPasswordLogin).toHaveBeenCalledWith(
      ' staff ',
      ' exact password ',
      'device-1',
    );
    expect(cookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, 'staff-token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: AUTH_COOKIE_MAX_AGE_MS,
      path: '/',
    });
    expect(result.user.role).toBe(Role.STAFF);
  });

  it('sets the shared session cookie after staff PIN login', async () => {
    const result = await controller.staffPinLogin(
      {
        staffId: 'staff-id',
        pin: '1234',
        deviceId: 'device-1',
      },
      response,
    );

    expect(staffPinLogin).toHaveBeenCalledWith(
      'staff-id',
      '1234',
      'device-1',
    );
    expect(cookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      'staff-token',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result.user.displayName).toBe('Casey Barista');
  });

  it.each([
    ['password', () => controller.staffPasswordLogin({}, response)],
    ['PIN', () => controller.staffPinLogin({}, response)],
  ])('requires a device identifier for staff %s login', async (_method, call) => {
    await expect(call()).rejects.toEqual(
      new BadRequestException(DEVICE_ID_REQUIRED_MESSAGE),
    );
    expect(staffPasswordLogin).not.toHaveBeenCalled();
    expect(staffPinLogin).not.toHaveBeenCalled();
  });

  it('passes missing staff credentials to the service for generic handling', async () => {
    await controller.staffPinLogin({ deviceId: 'device-1' }, response);

    expect(staffPinLogin).toHaveBeenCalledWith('', '', 'device-1');
  });
});
