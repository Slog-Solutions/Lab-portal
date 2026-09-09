import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { zLoginDto, type LoginDto } from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  // Phase 5 hardening: this is the one route on the whole server that
  // accepts a password guess with no other credential — the generous
  // global default (100/min, sized for legitimate dashboard polling)
  // would still let a script try 100 passwords a minute against it.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body(new ZodValidationPipe(zLoginDto)) dto: LoginDto) {
    return this.authService.login(dto);
  }
}
