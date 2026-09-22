import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  {
    files: ['**/*.{js,mjs}'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  { files: ['**/*.mjs'], languageOptions: { sourceType: 'module' } },
];
