/**
 * i18n 一致性测试（docs/06 §1 / §4，验收 T-51 的一部分）
 *
 * 三条不变式：
 * 1. 代码里 `t('literal')` 用到的 key 必须存在于 messages.json
 * 2. messages.json 里的 key 必须都在 `docs/06-i18n.md` 有文案记录（防止漏翻/漏文档）
 * 3. 带参数的文案必须用 Chrome 的 `$1..$9` 占位语法（写成 `%1` 时 Chrome 原样输出）
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');
const MESSAGES = join(ROOT, 'public', '_locales', 'zh_CN', 'messages.json');
const I18N_DOC = join(ROOT, 'docs', '06-i18n.md');

type Messages = Record<string, { message: string; description?: string }>;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 收集 `t('key')` 形式的字面量；表达式形式的（如 `t(code)`）无法静态解析，跳过 */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-z][a-z0-9_]+)'/g)) keys.add(m[1]!);
  }
  return keys;
}

const messages: Messages = JSON.parse(readFileSync(MESSAGES, 'utf8'));
const docText = readFileSync(I18N_DOC, 'utf8');

describe('i18n 一致性', () => {
  it('代码里用到的 key 都存在于 messages.json', () => {
    const used = usedKeys();
    expect(used.size).toBeGreaterThan(30);
    const missing = [...used].filter((k) => !(k in messages));
    expect(missing).toEqual([]);
  });

  it('messages.json 里的 key 都在与 06-i18n.md 中登记（不漏文档）', () => {
    const all = Object.keys(messages);
    const undoc = all.filter((k) => !docText.includes('`' + k + '`'));
    expect(undoc).toEqual([]);
  });

  it('每条文案都有非空 message', () => {
    for (const [k, v] of Object.entries(messages)) {
      expect(typeof v.message, `${k} 缺少 message`).toBe('string');
      expect(v.message.length, `${k} message 为空`).toBeGreaterThan(0);
    }
  });

  it('占位符使用 Chrome 的 $N 语法，不能出现 %N', () => {
    for (const [k, v] of Object.entries(messages)) {
      expect(/%\d/.test(v.message), `${k} 使用了 %N，Chrome 会原样输出：${v.message}`).toBe(false);
    }
  });

  it('带参数的 key 在代码里调用时确实传了参数（粗检：$1 出现即要求有 subs）', () => {
    for (const [k, v] of Object.entries(messages)) {
      if (!v.message.includes('$1')) continue;
      for (const file of walk(SRC)) {
        const src = readFileSync(file, 'utf8');
        const call = new RegExp(`\\bt\\(\\s*'${k}'(\\s*,\\s*\\[)?`, 'g');
        for (const m of src.matchAll(call)) {
          expect(m[1], `${k} 需要参数但调用处没传（${file}）`).toBeTruthy();
        }
      }
    }
  });
});
