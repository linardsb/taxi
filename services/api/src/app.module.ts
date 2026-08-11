import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './common/config/app-config.module';
import { DbModule } from './common/db/db.module';
import { KvModule } from './common/kv/kv.module';
import { AuthModule, JwtAuthGuard, RolesGuard } from './features/auth';
import { DispatchModule } from './features/dispatch';
import { DriversModule } from './features/drivers';
import { GeozonesModule } from './features/geozones';
import { LedgerModule } from './features/ledger';
import { NotificationsModule } from './features/notifications';
import { PaymentsModule } from './features/payments';
import { RealtimeModule } from './features/realtime';
import { RidesModule } from './features/rides';

@Module({
  imports: [
    AppConfigModule,
    DbModule,
    KvModule,
    AuthModule,
    RealtimeModule,
    DriversModule,
    GeozonesModule,
    // Before RidesModule: rides fires the SMS hooks this module owns (#63).
    NotificationsModule,
    // GeoModule, PlatformConfigModule and PricingModule arrive transitively.
    RidesModule,
    // After RidesModule: dispatch consumes the rides slice's repository and
    // transition writer.
    DispatchModule,
    LedgerModule,
    // After RidesModule and LedgerModule: payments composes the rides slice's
    // transition writer and repository with the ledger's posting engine. The
    // dependency runs one way only — RidesModule must never import this.
    PaymentsModule,
  ],
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
