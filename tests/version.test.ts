/**
 * 版本号单一真源测试（ADR-029）
 *
 * 用户要求："以后每次改动后都要更新版本号，这样方便我观察扩展是否重载成功了"。
 * 这里锁住三条不变式，防止以后再漂移：
 *
 * 1. `wxt.config.ts` 里**不能**再硬写 `version`（否则和 package.json 两个真源必然漂移）
 * 2. `package.json` 的 `version` 必须是合法 semver 且不为初始的 0.0.0 / 0.1.0
 * 3. `src/lib/version.ts` 走 `chrome.runtime.getManifest()`（读运行中的扩展，而不是打包期常量）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const wxtConfig = readFileSync(join(ROOT, 'wxt.config.ts'), 'utf8');
const versionSrc = readFileSync(join(ROOT, 'src', 'lib', 'version.ts'), 'utf8');

describe('版本号（ADR-029）', () => {
  it('版本号是合法 semver', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('版本号已从初始的 0.1.0 递增过（说明不是又忘了改）', () => {
    // 首次实施本决策时是把 0.1.0 提到 0.2.0；之后每次改动继续递增。
    // 只要不是 0.1.0，就说明版本号规则真的在生效。
    expect(pkg.version).not.toBe('0.1.0');
    expect(pkg.version).not.toBe('0.0.0');
  });

  it('wxt.config.ts 里不能再硬写 version（单一真源是 package.json）', () => {
    // 允许注释里出现 "version" 字样，但不能有 `version: '...'` 这样的赋值
    expect(wxtConfig).not.toMatch(/\bversion\s*:\s*['"]\d/);
  });

  it('面板版本号读的是运行中扩展的 manifest，而不是构建期常量', () => {
    expect(versionSrc).toContain('getManifest');
    // 不能把当前版本号硬编码进源码。只允许 `0.0.0` 这个兜底值
    // （getManifest 不可用时用，例如单测 / happy-dom 环境）。
    const literals = [...versionSrc.matchAll(/['"](\d+\.\d+\.\d+)['"]/g)].map((m) => m[1]!);
    expect(literals.every((v) => v === '0.0.0')).toBe(true);
    // 并且当前真实版本号一定不能出现在源码里
    expect(literals).not.toContain(pkg.version);
  });
});
