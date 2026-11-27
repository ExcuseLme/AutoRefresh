/**
 * 按 URL（页面）作用域隔离的**完整配置**（ADR-037）
 *
 * 用户需求（原话）："顺便把该扩展的所有配置都修改为 url 作用域记忆吧，不用全局共享配成记忆方案了"
 *
 * 之前只有 XHR 的 selector / 触发方式是 per-page 的（ADR-022），其余配置全部全局共享。
 * 现在整份 `Options` 都按 `pageKeyOf(url)`（协议 // 主机路径，忽略 query/hash）隔离。
 *
 * 设计要点：
 *   - **没有全局配置，也没有"默认回落到全局"**。一个页面第一次被用到时，
 *     就在它的 key 下写入一份 `DEFAULT_OPTIONS`（用户已确认：新页面一律用内置默认值）。
 *   - 会话启动时锁定 `pageKey`（`Session.pageKey`），整轮刷新都用**那一页**的配置 ——
 *     即使 follow 模式页面自己跳走了，也不会突然改用新页面的配置。
 *   - 与 `page-selectors.ts` 是两份独立的存储键、两份独立的模块职责：
 *     那边管"点哪个元素"，这边管"怎么刷"。合并在一个键里会让两套容量/清洗规则纠缠。
 */

import { DEFAULT_OPTIONS, type Options } from './options';
import { migrate } from './validate';

export type PageOptionsMap = Record<string, Options>;

/** `chrome.storage.local` 里的键名（与 `options` / `pageSelectors` 并列） */
export const PAGE_OPTIONS_KEY = 'pageOptions';

/** 最多保留多少个页面（超出按访问时间淘汰最旧的，防脏数据撑爆 storage） */
export const MAX_PAGE_OPTIONS = 300;

/** 每个条目额外记一个访问时间，供 LRU 用（不塞进 Options，避免污染 schema） */
export type PageOptionsEntry = { options: Options; updatedAt: number };

export type PageOptionsTable = Record<string, PageOptionsEntry>;

/** 清洗：逐条校验，坏的丢弃而不是整份作废 */
export function sanitizePageOptions(raw: unknown): PageOptionsTable {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: PageOptionsTable = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    // 兼容两种形状：直接存 Options，或 { options, updatedAt }
    const candidate = 'options' in v ? v.options : v;
    if (typeof candidate !== 'object' || candidate === null) continue;
    const migrated = migrate(candidate);
    const updatedAt = typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) ? v.updatedAt : 0;
    out[key] = { options: migrated, updatedAt };
  }
  return enforcePageOptionsCapacity(out);
}

/** 容量超限时淘汰最久没被访问的 */
export function enforcePageOptionsCapacity(
  table: PageOptionsTable,
  max: number = MAX_PAGE_OPTIONS,
): PageOptionsTable {
  const keys = Object.keys(table);
  if (keys.length <= max) return table;
  const sorted = keys
    .map((k) => ({ k, t: table[k]?.updatedAt ?? 0 }))
    .sort((a, b) => a.t - b.t);
  const next: PageOptionsTable = { ...table };
  for (const { k } of sorted.slice(0, keys.length - max)) delete next[k];
  return next;
}

/** 读全表（脏数据逐条清洗） */
export async function loadPageOptions(): Promise<PageOptionsTable> {
  const raw = await chrome.storage.local.get(PAGE_OPTIONS_KEY);
  return sanitizePageOptions(raw[PAGE_OPTIONS_KEY]);
}

/**
 * 取某个页面的配置；没有就**当场用默认值创建一条**并回写。
 *
 * 为什么不返回 null 让调用方自己处理默认值：配置的读取点很多（SW 的每轮刷新、
 * 面板的每次快照），每处都写一遍回落逻辑容易漏。这里收口成"永远拿得到一份配置"。
 */
export async function getOptionsForPage(pageKey: string | null): Promise<Options> {
  if (!pageKey) return { ...DEFAULT_OPTIONS };

  const table = await loadPageOptions();
  const existing = table[pageKey];
  if (existing) return existing.options;

  // 首次访问：写入默认值（新页面一律内置默认，不含任何全局继承）
  const fresh: PageOptionsEntry = { options: { ...DEFAULT_OPTIONS }, updatedAt: Date.now() };
  const next = enforcePageOptionsCapacity({ ...table, [pageKey]: fresh });
  await chrome.storage.local.set({ [PAGE_OPTIONS_KEY]: next });
  return fresh.options;
}

/** 写某个页面的配置（调用方必须已完成校验） */
export async function setOptionsForPage(pageKey: string, options: Options): Promise<void> {
  const table = await loadPageOptions();
  const next = enforcePageOptionsCapacity({
    ...table,
    [pageKey]: { options, updatedAt: Date.now() },
  });
  await chrome.storage.local.set({ [PAGE_OPTIONS_KEY]: next });
}

/** 监听 per-page 配置变化（popup 用来实时回显当前页面那份） */
export function watchPageOptions(cb: (table: PageOptionsTable) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local' || !(PAGE_OPTIONS_KEY in changes)) return;
    cb(sanitizePageOptions(changes[PAGE_OPTIONS_KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * 清掉 ADR-037 之前的**全局** `options` 键。
 *
 * 用户已确认：迁移时**不继承**旧的全局配置，每个页面一律从内置默认值开始。
 * 所以这里直接删掉旧键（而不是拿它当"新页面初始值"）—— 留着只会让人误以为还有全局配置。
 *
 * 幂等：键不存在时 `remove` 是无操作。
 */
export async function dropLegacyGlobalOptions(): Promise<void> {
  try {
    await chrome.storage.local.remove('options');
  } catch {
    /* 忽略：删不掉也不影响功能，只是留着一个不会被读的键 */
  }
}