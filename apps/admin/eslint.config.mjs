import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      // Same cap as the shared base (#112); this app extends `eslint-config-next`
      // and does not consume `@taxi/config/eslint/base.mjs`, so the rule and its
      // dev-instrument override have to be restated here or the gate misses it.
      'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    files: [
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/test/**',
      '**/tests/**',
      '**/scripts/**',
    ],
    rules: { 'max-lines': 'off' },
  },
]);

export default eslintConfig;
