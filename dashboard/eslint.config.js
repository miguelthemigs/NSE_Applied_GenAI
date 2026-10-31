import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^(motion$|[A-Z_])', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // React Compiler-era rules: flag legacy patterns, tracked as warnings
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  {
    files: ['**/*.test.{js,jsx}', 'src/test/**', 'vite.config.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.vitest } },
  },
  {
    // Playwright: Node globals; its fixture `use` callback is not a React hook
    files: ['e2e/**', 'playwright.config.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
])
