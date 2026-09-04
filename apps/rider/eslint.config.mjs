import { defineConfig } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default defineConfig([
  ...expoConfig,
  eslintPluginPrettierRecommended,
  {
    ignores: ['dist/*', '.expo/*', 'android/*', 'ios/*', 'expo-env.d.ts'],
  },
  {
    rules: {
      // Same cap as the shared base (#112); this app extends
      // `eslint-config-expo` and does not consume `@taxi/config/eslint/base.mjs`,
      // so the rule and its dev-instrument override have to be restated here
      // or the gate misses it.
      'max-lines': [
        'error',
        { max: 500, skipBlankLines: false, skipComments: false },
      ],
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
  {
    // Stricter than the driver app's, which allows `warn`/`error` for two
    // background paths where a silent failure would be invisible (push
    // registration, the sqlite queue). This app has neither: it has no headless
    // task and no offline queue, so every failure it can have is one a rider is
    // looking at, and it belongs on screen through `Banner`/`TextField` rather
    // than in a log nobody reads. Widen this only when a genuinely invisible
    // path arrives.
    files: ['src/features/**/*.ts', 'src/features/**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { 'no-console': 'error' },
  },
]);
