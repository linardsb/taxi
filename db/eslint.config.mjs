// @ts-check
import base from '@taxi/config/eslint/base.mjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(...base, {
  languageOptions: {
    globals: {
      // No test globals: this package runs vitest, and vitest.config.ts does
      // not set `globals: true` — every test imports from "vitest" directly.
      ...globals.node,
    },
    sourceType: 'commonjs',
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
});
