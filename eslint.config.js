import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2021,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      // 迁移代码大量使用 any（API/store 宽松类型，见 MIGRATION.md 的类型债务），刻意放开。
      '@typescript-eslint/no-explicit-any': 'off',
      // 未使用变量降为 warn，允许下划线前缀忽略。
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  // 逐字移植的框架无关 API 客户端：仅做基本 JS 校验，类型化为后续工作。
  {
    files: ['src/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      // 这两个文件顶部刻意使用 @ts-nocheck（见 MIGRATION.md 类型债务）。
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
)
