import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { LoginDto } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Two kinds of principal share one token shape (`kind` discriminates):
 * a human User (dashboard login) or a Station (Phase 3 — see
 * mintStationToken). `kind` is optional and defaults to 'user' so tokens
 * signed before this field existed keep verifying unchanged.
 */
export interface JwtPayload {
  sub: string;
  role: string;
  serviceNumber: string;
  kind?: 'user' | 'station';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<{ accessToken: string; user: { id: string; role: string; fullName: string } }> {
    const user = await this.prisma.user.findUnique({ where: { serviceNumber: dto.serviceNumber } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload: JwtPayload = { sub: user.id, role: user.role, serviceNumber: user.serviceNumber, kind: 'user' };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, user: { id: user.id, role: user.role, fullName: user.fullName } };
  }

  async verify(token: string): Promise<JwtPayload> {
    return this.jwt.verifyAsync<JwtPayload>(token);
  }

  /**
   * Station credential (Phase 3 — closes the gap `station:hello`'s own
   * comment and the compliance matrix both flagged since Phase 1:
   * "no station token yet"). Minted fresh on every station:hello, so a
   * long TTL just means fewer no-op reconnect gaps, not a bigger blast
   * radius on compromise — the outbox/commands surface doesn't trust this
   * token for anything beyond "this HTTP caller is a genuine station",
   * the same posture LiveKit tokens already have.
   *
   * `role: 'STATION'` is deliberately not a UserRole member — RolesGuard's
   * @Roles(UserRole.TEACHER, UserRole.ADMIN) checks can never accidentally
   * admit a station token just because role-string comparison is loose.
   */
  async mintStationToken(stationId: string): Promise<string> {
    const payload: JwtPayload = { sub: stationId, role: 'STATION', serviceNumber: '', kind: 'station' };
    return this.jwt.signAsync(payload, { expiresIn: '12h' });
  }

  static async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  }
}
