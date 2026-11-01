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
    // A ratchet on line length. Several files hold lines of 300 to 1,000 characters (the purchase-history pages, the
    // rule tables), which no reviewer can read; new code may not add to them. Files already over the limit are
    // listed so the rule can start at once: take a file off this list when its long lines are broken up, and never
    // add one. Comments, URLs and regular-expression literals do not count.
    files: ['src/**/*.js'],
    ignores: [
      'src/options/history-dashboard.js', 'src/engine/score.js', 'src/content/orders.js', 'src/options/history.js',
      'src/content/cart.js', 'src/engine/db/labels.js', 'src/options/library.js', 'src/engine/db/allergens.js',
      'src/content/order-hover.js', 'src/content/sort.js', 'src/engine/categories.js', 'src/engine/db/shopping.js',
      'src/background.js', 'src/content/extract.js', 'src/content/main.js', 'src/engine/db/additives.js',
      'src/engine/db/purchase-history.js', 'src/options/sorted.js', 'src/stores/cart.js', 'src/worker/history-scan.js',
    ],
    rules: { 'max-len': ['warn', { code: 300, ignoreUrls: true, ignoreComments: true, ignoreRegExpLiterals: true }] },
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
        cleanText: 'readonly',
        cleanProductPost: 'readonly',
        boundedRecord: 'readonly',
        AMAZON_HOST: 'readonly',
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
        bindToggle: 'readonly',
        applyScoring: 'readonly',
        msg: 'readonly',
        startSettingsPage: 'readonly',
      },
    },
  },
  {
    files: ['src/options/settings.js'],
    languageOptions: { globals: { wireDatabase: 'readonly', paintTabs: 'readonly' } },
  },
  {
    // tabs.js is a classic script loaded before popup.js on the popup.
    files: ['src/options/popup.js'],
    languageOptions: { globals: { paintTabs: 'readonly' } },
  },
];
