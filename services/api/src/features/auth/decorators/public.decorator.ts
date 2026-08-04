import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:isPublic';

/** The only way a route is reachable without a token — auth is fail-closed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
