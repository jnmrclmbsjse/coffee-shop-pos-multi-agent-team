import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/src/generated/**',
      '**/test-results/**',
      // Design mockups are standalone browser-JS prototypes for handoff, not
      // part of any package build — linting them with the product's TS ruleset
      // is a scope error and lets a throwaway artifact gate real CI (see #88).
      'docs/design/mockups/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{cjs,js,mjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        module: 'readonly',
      },
    },
  },
);
