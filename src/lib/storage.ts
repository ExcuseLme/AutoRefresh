/**
 * 面板的纯 UI 偏好（本地存储，不进配置、不参与 per-page 隔离）。
 *
 * ADR-037：**全局配置的读写已全部移除** —— 所有配置都按页面（URL）存在
 * `lib/page-options.ts` 的 `pageOptions` 表里，没有"全局 options"这回事了。
 * 这里只留与功能无关的界面偏好（折叠状态），它天然应当全局面板共享。
 */
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
