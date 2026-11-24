import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: true,
    // 默认 node：纯逻辑单测不需要 DOM，跑得更快。
    // 需要 DOM 的文件在顶部用 `// @vitest-environment happy-dom` 单独声明（见 tests/dom-click.test.ts）。
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
