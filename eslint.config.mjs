// Optional lint for this dependency-free MV3 extension. Run: npm run lint
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['vendor/**', 'dist/**', 'node_modules/**', 'docs/history/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.{js,mjs}', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
        AIR: 'writable',
        AIRmodule: 'readonly',
        chrome: 'readonly',
        Tesseract: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-undef': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // background.js pulls these in with importScripts; they are not imports.
    files: ['src/background.js'],
    languageOptions: {
      globals: {
        importScripts: 'readonly',
        allowMessage: 'readonly',
        isOwnExtension: 'readonly',
        isAmazonTabSender: 'readonly',
        isRetailerTabSender: 'readonly',
        isOptionsPageSender: 'readonly',
        isOffscreenSender: 'readonly',
        isSortedViewSender: 'readonly',
        getSheetIndex: 'readonly',
        putSheetIndex: 'readonly',
        clearSheetIndex: 'readonly',
      },
    },
  },
  {
    // settings-database.js is a second classic script on the options page.
    files: ['src/options/settings-database.js'],
    languageOptions: {
      globals: {
        PREFS: 'readonly',
        markUrl: 'readonly',
        readUrlField: 'readonly',
        flash: 'readonly',
        persist: 'readonly',
        scoringPayload: 'readonly',
        applyScoring: 'readonly',
        msg: 'readonly',
        startSettingsPage: 'readonly',
      },
    },
  },
  {
    files: ['src/options/settings.js'],
    languageOptions: { globals: { wireDatabase: 'readonly' } },
  },
];
