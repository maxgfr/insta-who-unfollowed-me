// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jest from 'eslint-plugin-jest';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['build/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/**/*.test.ts'],
    ...jest.configs['flat/recommended'],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },
  // Keep formatting concerns out of eslint; prettier owns them.
  prettier,
);
