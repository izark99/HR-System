import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'fixtures/**', '.claude/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: [
          './apps/web/tsconfig.app.json',
          './apps/web/tsconfig.test.json',
          './apps/web/tsconfig.node.json',
          './packages/flow-schema/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: globals.browser },
  },
  {
    // Engine runs in a Web Worker: no DOM, and never log data to the console.
    files: ['apps/web/src/engine/**/*.ts'],
    ignores: ['apps/web/src/engine/**/*.test.ts', 'apps/web/src/engine/__tests__/**'],
    languageOptions: { globals: globals.worker },
    rules: { 'no-console': 'error' },
  },
  {
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
