import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },

  // 共通：TypeScript の推奨ルール（型情報つき）
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 未使用引数は _ 始まりなら許す（インターフェースを揃えるときに使う）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // React コンポーネント
  // react-hooks は configs['recommended-latest'] が旧形式（plugins が配列）なので、
  // flat config 用の configs.flat['recommended-latest'] を使う
  {
    files: ['src/**/*.tsx'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
  },

  // domain 層は React・DOM・localStorage に依存させない。
  // 詳細は .claude/rules/domain-purity.md。ここは機械的に落とすための最低限の防波堤。
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-*', '*/react'], message: 'domain 層は React に依存させない' },
            {
              group: ['recharts', 'react-hook-form'],
              message: 'domain 層は UI ライブラリに依存させない',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'domain 層は DOM に依存させない' },
        { name: 'document', message: 'domain 層は DOM に依存させない' },
        {
          name: 'localStorage',
          message: 'domain 層は localStorage に依存させない。呼び出し側の責務',
        },
        { name: 'sessionStorage', message: 'domain 層は sessionStorage に依存させない' },
        { name: 'fetch', message: 'domain 層は通信しない' },
      ],
      // 現在時刻の暗黙参照を禁止する（引数で受け取る）
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'domain 層で new Date() を引数なしで呼ばない。基準日は引数で受け取る',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'domain 層で Date.now() を呼ばない。基準日は引数で受け取る',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'domain 層で Math.random() を呼ばない。純粋関数を保つ',
        },
      ],
    },
  },

  // 設定ファイルは Node 環境
  {
    files: ['*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // Prettier と競合するフォーマット系ルールを最後に無効化する
  prettier,
)
