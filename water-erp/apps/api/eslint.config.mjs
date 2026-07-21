import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      // NestJS 常用模式放宽
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      // 项目用 require 导入 CJS 函数导出包(如 sanitize-html,见 CLAUDE.md)
      '@typescript-eslint/no-require-imports': 'off',
      // prefer-const 降为 warn(风格,不阻塞 CI)
      'prefer-const': 'warn',
    },
  },
);
