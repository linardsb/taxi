// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

/**
 * The flat-config base every TypeScript package in the monorepo lints against.
 *
 * `languageOptions` is deliberately absent: each package supplies one complete
 * block of its own — globals, `sourceType`, and the full `parserOptions`
 * including the per-package `tsconfigRootDir`. Splitting it across two entries
 * would make the effective config depend on how deeply flat config merges
 * partial `languageOptions`, which is exactly the kind of thing that drifts
 * silently. Whatever a package needs on top (extra globals, a rule it turns
 * off) goes in that package's own config, not here (#53).
 */
export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // The omit-by-rest idiom (`const { x: _drop, ...rest } = obj`) is
      // legitimate; the base-ESLint default for this option is `false`, which
      // flags it.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
