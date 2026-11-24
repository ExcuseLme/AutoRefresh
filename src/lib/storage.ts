import { DEFAULT_OPTIONS, type Options } from './options';
import { migrate, needsMigration } from './validate';

const KEY = 'options';

/**
 * 读全局配置（缺失/脏数据自动迁移到默认值）。
 *
 * v1 → v2 的迁移结果**回写一次**（ADR-021）：否则每次读取都要重跑迁移，
 * 而且用户看 storage 里永远是旧 schema，排查问题时会困惑。
 * 回写失败不影响本次读取（内存里已经是迁移后的值）。
 */
export async function getOptions(): Promise<Options> {
  const raw = await chrome.storage.local.get(KEY);
  const next = migrate(raw[KEY]);
  if (needsMigration(raw[KEY])) {
    try {
      await chrome.storage.local.set({ [KEY]: next });
    } catch {
      /* 忽略：本次读取已用迁移后的值 */
    }
  }
  return next;
}

/** 写全局配置（调用方必须已完成校验） */
export async function setOptions(next: Options): Promise<void> {
  await chrome.storage.local.set({ [KEY]: next });
}

export async function resetOptions(): Promise<Options> {
  const next = { ...DEFAULT_OPTIONS };
  await setOptions(next);
  return next;
}

/** 监听全局配置变化（所有上下文共享通道） */
export function watchOptions(cb: (next: Options) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local' || !(KEY in changes)) return;
    cb(migrate(changes[KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ── 面板折叠状态属于纯 UI 偏好，放 localStorage，不进 options（docs/04 §4.3）
const COLLAPSE_KEY = 'ui:options-section-collapsed';

export function readOptionsCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeOptionsCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  } catch {
    // 忽略：不影响功能
  }
}
