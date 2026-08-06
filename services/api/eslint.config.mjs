// @ts-check
import base from '@taxi/config/eslint/base.mjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(...base, {
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
});
