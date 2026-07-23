import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type AuthenticatedUser,
  type LoginResponse,
  Role,
} from '@coffee-shop/shared';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants';
import type { AuthTokenPayload } from './auth.types';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$JhMQSBwJoG57ZJAQym8M4w$6/N1/P+wObGqzGAF1x3CF2WqOkOnHj2TyptxKZMgAdU';

export interface LoginResult {
  response: LoginResponse;
  token: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.usersService.findByUsername(username);
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;

    let passwordMatches = false;
    try {
      passwordMatches = await argon2.verify(passwordHash, password);
    } catch {
      passwordMatches = false;
    }

    if (!user || !passwordMatches || user.role !== Role.ADMIN) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      role: Role.ADMIN,
    };
    const payload: AuthTokenPayload = {
      sub: authenticatedUser.id,
      username: authenticatedUser.username,
      role: authenticatedUser.role,
    };

    return {
      response: { user: authenticatedUser },
      token: await this.jwtService.signAsync(payload),
    };
  }
}
