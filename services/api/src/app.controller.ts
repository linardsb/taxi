import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './features/auth';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Both handlers are @Public(): the global JwtAuthGuard is fail-closed, and
  // /health must answer 200 without a token.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  getHealth(): { status: 'ok'; service: 'api' } {
    return { status: 'ok', service: 'api' };
  }
}
