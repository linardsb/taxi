import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './common/config/app-config.module';
import { DbModule } from './common/db/db.module';
import { KvModule } from './common/kv/kv.module';
import { AuthModule, JwtAuthGuard, RolesGuard } from './features/auth';
import { RealtimeModule } from './features/realtime';

@Module({
  imports: [AppConfigModule, DbModule, KvModule, AuthModule, RealtimeModule],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: global guards run in registration order, so authenticate
    // before authorizing — RolesGuard would otherwise read an undefined user.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
