// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    // Build output, generated route types, native projects and the pinned
    // upstream sources in vendor/ (never edited here, see vendor/hermes/PIN.md).
    ignores: ['dist/*', 'coverage/*', '.expo/*', 'ios/*', 'android/*', 'vendor/*']
  },
  {
    rules: {
      // eslint-plugin-react-hooks 7 adds checks for code the React Compiler
      // rewrites. The app does not run the React Compiler (app.json has no
      // `reactCompiler` experiment), so these three stay off until it does.
      // rules-of-hooks and exhaustive-deps stay on.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off'
    }
  }
])
