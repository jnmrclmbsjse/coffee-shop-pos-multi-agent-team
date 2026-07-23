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
import type { LoginRequest, LoginResponse } from '@coffee-shop/shared';
import type { Response } from 'express';
import {
  AUTH_COOKIE_MAX_AGE_MS,
  AUTH_COOKIE_NAME,
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
  @Roles(Role.ADMIN)
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
    const sameSite = cookieSameSite();
    response.cookie(AUTH_COOKIE_NAME, result.token, {
      httpOnly: true,
      secure: cookieIsSecure(sameSite),
      sameSite,
      maxAge: AUTH_COOKIE_MAX_AGE_MS,
      path: '/',
    });

    return result.response;
  }
}
