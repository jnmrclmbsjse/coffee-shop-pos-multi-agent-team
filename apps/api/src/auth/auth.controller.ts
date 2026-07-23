import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type {
  LoginRequest,
  LoginResponse,
  StaffLoginResponse,
  StaffPasswordLoginRequest,
  StaffPinLoginRequest,
} from '@coffee-shop/shared';
import type { Response } from 'express';
import {
  AUTH_COOKIE_MAX_AGE_MS,
  AUTH_COOKIE_NAME,
  DEVICE_ID_REQUIRED_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
  USERNAME_REQUIRED_MESSAGE,
} from './auth.constants';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

type SameSite = 'lax' | 'none' | 'strict';

function cookieSameSite(): SameSite {
  const configured = process.env.AUTH_COOKIE_SAME_SITE?.toLowerCase();
  if (configured === 'none' || configured === 'strict') {
    return configured;
  }

  return 'lax';
}

function cookieIsSecure(sameSite: SameSite): boolean {
  return (
    sameSite === 'none' ||
    process.env.AUTH_COOKIE_SECURE?.toLowerCase() !== 'false'
  );
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('session')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF)
  session(@Req() request: AuthenticatedRequest): LoginResponse {
    return { user: request.user! };
  }

  @Post('login')
  async login(
    @Body() body: Partial<LoginRequest> | null | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    if (typeof body?.username !== 'string' || body.username.trim().length === 0) {
      throw new BadRequestException(USERNAME_REQUIRED_MESSAGE);
    }
    if (typeof body.password !== 'string' || body.password.length === 0) {
      throw new BadRequestException(PASSWORD_REQUIRED_MESSAGE);
    }

    const result = await this.authService.login(body.username, body.password);
    this.setSessionCookie(response, result.token);

    return result.response;
  }

  @Post('staff/login')
  async staffPasswordLogin(
    @Body() body: Partial<StaffPasswordLoginRequest> | null | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StaffLoginResponse> {
    const deviceId = this.requireDeviceId(body?.deviceId);
    const result = await this.authService.staffPasswordLogin(
      typeof body?.username === 'string' ? body.username : '',
      typeof body?.password === 'string' ? body.password : '',
      deviceId,
    );
    this.setSessionCookie(response, result.token);
    return result.response;
  }

  @Post('staff/pin')
  async staffPinLogin(
    @Body() body: Partial<StaffPinLoginRequest> | null | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StaffLoginResponse> {
    const deviceId = this.requireDeviceId(body?.deviceId);
    const result = await this.authService.staffPinLogin(
      typeof body?.staffId === 'string' ? body.staffId : '',
      typeof body?.pin === 'string' ? body.pin : '',
      deviceId,
    );
    this.setSessionCookie(response, result.token);
    return result.response;
  }

  private requireDeviceId(deviceId: unknown): string {
    if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      throw new BadRequestException(DEVICE_ID_REQUIRED_MESSAGE);
    }

    return deviceId;
  }

  private setSessionCookie(response: Response, token: string): void {
    const sameSite = cookieSameSite();
    response.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: cookieIsSecure(sameSite),
      sameSite,
      maxAge: AUTH_COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }
}
