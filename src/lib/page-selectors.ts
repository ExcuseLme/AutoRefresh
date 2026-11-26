/**
 * 按页面（URL 级）隔离的 XHR 自动点击配置。设计依据 docs/11 §1 / ADR-022
 *
 * 为什么要隔离：全局共享时，在 B 页面选完元素会把 A 页面正在跑的会话的点击目标
 * 一起改掉 —— 用户实测踩到过。selector 是**某个页面上某个元素**的属性，
 * 天然应该跟着页面走。
 *
 * 隔离粒度（用户已确认）：**协议 + 主机 + 路径**，忽略 query 与 #hash。
 *   - 忽略 hash：Gmail 切文件夹（`#inbox` → `#sent`）共用同一份配置，因刷新按钮是同一个
 *   - 忽略 query：网易邮箱这类 `?sid=xxxx` 每次登录都变的页面，重新登录后配置仍然有效
 *   - 但**不是域名级**：`/mail/u/0/` 与 `/mail/u/1/` 是两个页面，配置互不影响
 */

import type { ClickAction } from './options';

export type PageSelectorEntry = {
  selector: string;
  /** 单击还是双击，与 selector 一起按页面存（ADR-022） */
  action: ClickAction;
  /** 最后写入时间，用于容量超限时的 LRU 淘汰 */
  updatedAt: number;
};

export type PageSelectorMap = Record<string, PageSelectorEntry>;

/** `chrome.storage.local` 里的键名（与 `options` 并列，互不影响） */
export const PAGE_SELECTORS_KEY = 'pageSelectors';

/** 最多保留多少个页面（超出按 updatedAt 淘汰最旧的，防脏数据撑爆 storage） */
export const MAX_PAGES = 300;

/** 单个 selector 的最大长度（正常 selector 远小于此） */
export const MAX_SELECTOR_LEN = 2000;

/**
 * 计算页面的隔离 key：`协议//主机路径`（去掉 query 与 hash）。
 *
 * 无法解析的 URL 返回 null —— 调用方应当把它当作"这个页面没有配置"，
 * 而不是回落到某个全局值（那就又变成共享了）。
 */
export function pageKeyOf(url: string | undefined | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // 只支持 http/https（与 isRefreshableUrl 一致）；扩展页/文件页没有"页面"语义
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.host.toLowerCase();
  let path = parsed.pathname || '/';
  // 尾部斜杠统一：`/a` 与 `/a/` 视为同一页面（根路径保留 `/`）
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return `${parsed.protocol}//${host}${path}`;
}

/**
 * 取某个页面的配置（没有就是 null，绝不回落到别的页面）。
 *
 * ADR-035：**selector 为空也算"有配置"**。触发方式（单击/双击）与 selector 是两个
 * 互相独立的偏好，用户可以先定好触发方式再填 selector —— 早返回 null 会让面板
 * 永远读不到 action，表现为"点了双击没反应"。
 */
export function getPageEntry(map: PageSelectorMap | undefined, url: string | undefined): PageSelectorEntry | null {
  const key = pageKeyOf(url);
  if (!key || !map) return null;
  return getEntryByKey(map, key);
}

/** 已知 pageKey 时直接取（面板里少做一次 URL 解析） */
export function getEntryByKey(map: PageSelectorMap | undefined, key: string | null): PageSelectorEntry | null {
  if (!key || !map) return null;
  const entry = map[key];
  return entry ? { selector: entry.selector, action: entry.action, updatedAt: entry.updatedAt } : null;
}

/**
 * 写入/覆盖某个页面的配置，返回新 map（不修改入参）。
 *
 * ADR-035：selector 为空时**保留这条记录**（清空 selector 只清 selector，
 * 不动触发方式）。之前是直接删记录，会把用户设好的「双击」一起丢掉。
 */
export function setPageEntry(
  map: PageSelectorMap | undefined,
  url: string | undefined,
  selector: string,
  action: ClickAction,
): PageSelectorMap {
  const key = pageKeyOf(url);
  if (!key) return map ?? {};

  const trimmed = selector.trim().slice(0, MAX_SELECTOR_LEN);
  const next: PageSelectorMap = { ...(map ?? {}) };

  // 从未配置过、也没写 selector：不建空壳（避免每个页面都留一条空记录）
  if (!trimmed && !next[key]) return next;

  next[key] = { selector: trimmed, action, updatedAt: Date.now() };
  return enforceCapacity(next);
}

/**
 * 只改某个页面的触发方式（ADR-035）。
 *
 * 与 `setPageEntry` 的区别：**不需要已有 selector**。用户可以先切「双击」，
 * 之后再去拾取元素 —— 拾取时 `applyPickerResult` 会读到这里的 action 一并写入。
 */
export function setActionEntry(
  map: PageSelectorMap | undefined,
  url: string | undefined,
  action: ClickAction,
): PageSelectorMap {
  const key = pageKeyOf(url);
  if (!key) return map ?? {};

  const next: PageSelectorMap = { ...(map ?? {}) };
  const existing = next[key];
  next[key] = { selector: existing?.selector ?? '', action, updatedAt: Date.now() };
  return enforceCapacity(next);
}

/** 容量超限时淘汰最旧的（按 updatedAt） */
export function enforceCapacity(map: PageSelectorMap, max: number = MAX_PAGES): PageSelectorMap {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;

  const sorted = keys
    .map((k) => ({ k, t: map[k]?.updatedAt ?? 0 }))
    .sort((a, b) => a.t - b.t);
  const next: PageSelectorMap = { ...map };
  for (const { k } of sorted.slice(0, keys.length - max)) delete next[k];
  return next;
}

/** 清洗从 storage 读到的脏数据：逐条校验，坏的丢弃而不是整份作废 */
export function sanitizePageSelectors(raw: unknown): PageSelectorMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: PageSelectorMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    const selector = typeof v.selector === 'string' ? v.selector.trim() : '';
    if (selector.length > MAX_SELECTOR_LEN) continue;
    if (pageKeyOf(key) !== key) continue; // key 本身必须是合法 pageKey
    // ADR-035：selector 可以为空（用户只设了触发方式还没拾取元素），保留这条记录
    const action: ClickAction = v.action === 'double' ? 'double' : 'single';
    const updatedAt = typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) ? v.updatedAt : 0;
    out[key] = { selector, action, updatedAt };
  }
  return enforceCapacity(out);
}

// ── storage 层（chrome.storage.local 的 'pageSelectors' 键）──────────────

/** 读全表（脏数据逐条清洗） */
export async function loadPageSelectors(): Promise<PageSelectorMap> {
  const raw = await chrome.storage.local.get(PAGE_SELECTORS_KEY);
  return sanitizePageSelectors(raw[PAGE_SELECTORS_KEY]);
}

/** 读某个页面的配置（没有任何回落，只按 URL 精确匹配） */
export async function getSelectorForUrl(url: string | undefined): Promise<PageSelectorEntry | null> {
  return getPageEntry(await loadPageSelectors(), url);
}

/** 写某个页面的配置（ADR-035：清空 selector 只清 selector，保留触发方式） */
export async function setSelectorForUrl(
  url: string | undefined,
  selector: string,
  action: ClickAction,
): Promise<PageSelectorMap> {
  const next = setPageEntry(await loadPageSelectors(), url, selector, action);
  await chrome.storage.local.set({ [PAGE_SELECTORS_KEY]: next });
  return next;
}

/** 只改某个页面的触发方式（ADR-035：不需要已有 selector） */
export async function setActionForUrl(
  url: string | undefined,
  action: ClickAction,
): Promise<PageSelectorMap> {
  const next = setActionEntry(await loadPageSelectors(), url, action);
  await chrome.storage.local.set({ [PAGE_SELECTORS_KEY]: next });
  return next;
}

/** 监听 per-page 配置变化（popup 用来实时回显） */
export function watchPageSelectors(cb: (next: PageSelectorMap) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local' || !(PAGE_SELECTORS_KEY in changes)) return;
    cb(sanitizePageSelectors(changes[PAGE_SELECTORS_KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
