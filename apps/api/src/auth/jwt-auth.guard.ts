import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@coffee-shop/shared';
import { AUTH_COOKIE_NAME } from './auth.constants';
import type { AuthenticatedRequest, AuthTokenPayload } from './auth.types';

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }

  return null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const token = readCookie(request.headers.cookie, AUTH_COOKIE_NAME);

    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token);
      if (
        !payload.sub ||
        !payload.username ||
        (payload.role !== Role.ADMIN && payload.role !== Role.STAFF)
      ) {
        throw new UnauthorizedException();
      }

      request.user = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
        ...(payload.displayName ? { displayName: payload.displayName } : {}),
      };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
