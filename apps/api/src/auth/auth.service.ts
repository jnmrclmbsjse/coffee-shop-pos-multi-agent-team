import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type AuthenticatedUser,
  type LoginResponse,
  Role,
  type StaffAuthenticatedUser,
  type StaffLoginResponse,
} from '@coffee-shop/shared';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';
import { AuthAttemptThrottleService } from './auth-attempt-throttle.service';
import {
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_STAFF_CREDENTIALS_MESSAGE,
  THROTTLED_MESSAGE,
} from './auth.constants';
import type { AuthTokenPayload } from './auth.types';

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$JhMQSBwJoG57ZJAQym8M4w$6/N1/P+wObGqzGAF1x3CF2WqOkOnHj2TyptxKZMgAdU';
const DUMMY_PIN_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$WQAvow9WK1zaZ2KAjyd5Hg$qNiDlWcAQzybL0Ovv4oQdRQXsJGInrxk+AaC0MEkes4';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LoginResult<TResponse = LoginResponse> {
  response: TResponse;
  token: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly throttle: AuthAttemptThrottleService,
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

  async staffPasswordLogin(
    username: string,
    password: string,
    deviceId: string,
  ): Promise<LoginResult<StaffLoginResponse>> {
    const user = await this.usersService.findByUsername(username);
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await this.verify(passwordHash, password);
    const throttleKey = user
      ? this.throttle.keyForUser(deviceId, user.id)
      : this.throttle.keyForUnknown(deviceId, 'password', username);

    this.throwIfThrottled(throttleKey);

    if (
      !user ||
      !passwordMatches ||
      user.role !== Role.STAFF ||
      !user.isActive
    ) {
      this.throttle.recordFailure(throttleKey);
      throw new UnauthorizedException(INVALID_STAFF_CREDENTIALS_MESSAGE);
    }

    this.throttle.reset(throttleKey);
    return this.staffLoginResult(user);
  }

  async staffPinLogin(
    staffId: string,
    pin: string,
    deviceId: string,
  ): Promise<LoginResult<StaffLoginResponse>> {
    const user = UUID_PATTERN.test(staffId)
      ? await this.usersService.findById(staffId)
      : null;
    const pinHash = user?.pinHash ?? DUMMY_PIN_HASH;
    const pinMatches = await this.verify(pinHash, pin);
    const throttleKey = user
      ? this.throttle.keyForUser(deviceId, user.id)
      : this.throttle.keyForUnknown(deviceId, 'pin', staffId);

    this.throwIfThrottled(throttleKey);

    if (
      !user ||
      !/^\d{4}$/.test(pin) ||
      !user.pinHash ||
      !pinMatches ||
      user.role !== Role.STAFF ||
      !user.isActive
    ) {
      this.throttle.recordFailure(throttleKey);
      throw new UnauthorizedException(INVALID_STAFF_CREDENTIALS_MESSAGE);
    }

    this.throttle.reset(throttleKey);
    return this.staffLoginResult(user);
  }

  private async verify(hash: string, secret: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, secret);
    } catch {
      return false;
    }
  }

  private throwIfThrottled(key: string): void {
    const retryAfterSeconds = this.throttle.retryAfterSeconds(key);
    if (retryAfterSeconds === null) {
      return;
    }

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: THROTTLED_MESSAGE.replace(
          '{seconds}',
          String(retryAfterSeconds),
        ),
        error: 'Too Many Requests',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async staffLoginResult(
    user: {
      id: string;
      username: string;
      displayName: string;
    },
  ): Promise<LoginResult<StaffLoginResponse>> {
    const authenticatedUser: StaffAuthenticatedUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: Role.STAFF,
    };
    const payload: AuthTokenPayload = {
      sub: authenticatedUser.id,
      username: authenticatedUser.username,
      displayName: authenticatedUser.displayName,
      role: authenticatedUser.role,
    };

    return {
      response: { user: authenticatedUser },
      token: await this.jwtService.signAsync(payload),
    };
  }
}
