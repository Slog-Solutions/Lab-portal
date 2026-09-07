import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { zLoginDto, type LoginDto } from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body(new ZodValidationPipe(zLoginDto)) dto: LoginDto) {
    return this.authService.login(dto);
  }
}
