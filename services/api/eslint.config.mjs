// @ts-check
import base from '@taxi/config/eslint/base.mjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Nest's testing utilities and the Drizzle query builders are typed loosely
      // enough that the escape hatch stays open here, and only here.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // #316 (K1, option E3): protected records are never deleted from app code.
    // This list mirrors `PROTECTED_TABLES` + `DELETE_BLOCKED_TABLES` in
    // `@taxi/db` (db/src/protected-tables.ts) — a table added there is added here.
    // The database triggers (migration 0018) are the guarantee; this is the
    // earlier, louder signal.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='delete'][arguments.0.name=/^(rides|drivers|vehicles|rideEvents|rideOffers)$/]",
          message:
            'Protected record (#316, K1): rides/drivers/vehicles are never deleted; ride_events/ride_offers are append-only. Retire or append instead.',
        },
      ],
    },
  },
);
