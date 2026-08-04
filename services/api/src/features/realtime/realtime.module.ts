import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [AuthModule], // for AuthTokenService — the handshake's only dependency
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
