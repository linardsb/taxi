import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { SMS_PROVIDER } from './sms/sms.tokens';
import { StubSmsProvider } from './sms/stub-sms.provider';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_SECRET,
        // `ms` types expiresIn as a template-literal union ('30d', '2h', …),
        // which no env-sourced string can satisfy statically. The value is a
        // validated string; `ms` throws at boot on anything it can't parse.
        signOptions: {
          expiresIn: env.JWT_EXPIRES_IN as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    AuthTokenService,
    { provide: SMS_PROVIDER, useClass: StubSmsProvider },
  ],
  // AuthTokenService is the realtime gateway's only dependency on this slice.
  exports: [AuthTokenService],
})
export class AuthModule {}
