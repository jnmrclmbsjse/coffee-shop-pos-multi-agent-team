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
      // Claude may place complete repository worktrees below a nested .claude
      // directory. They are independent checkouts and must not make the parent
      // checkout lint the same source tree (or its transient state) twice.
      '**/.claude/**',
      // Discovery browser state and screenshots are intentionally gitignored
      // working evidence, not repository JavaScript/TypeScript inputs. Keep the
      // recursive forms aligned with .gitignore so nested agent worktrees and
      // locally-created evidence cannot unexpectedly enter `eslint .`.
      '**/.playwright/**',
      '**/.playwright-mcp/**',
      '**/artifacts/**',
      '**/docs/discovery-artifacts/**',
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
