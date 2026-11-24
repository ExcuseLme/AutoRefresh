/**
 * keep-active 的 MAIN world 补丁。设计依据 docs/05-refresh-engine.md §6
 *
 * 这个函数会被 `chrome.scripting.executeScript({ world: 'MAIN', func })` 序列化后在页面
 * 主世界里执行，因此 **不能引用模块作用域的任何变量/类型**，必须是一个完全自包含的函数。
 * 同理，`keep-active` 的 TTL 自愈通过 CS 侧的 `sessionStorage` 实现，不在这里做。
 */

export const KEEP_ACTIVE_TTL_MS = 5 * 60 * 1000; // ADR-003：60s → 5min
export const KEEP_ACTIVE_FAKE_ACTIVITY_MS = 45_000;
export const KEEP_ACTIVE_STORAGE_KEY = '__ar_keep_active';

/** 在 MAIN world 里打补丁；幂等（用 window 标记防重复） */
export function installKeepActive(): void {
  type W = typeof window & { __arKeepActivePatched?: boolean };
  const w = window as W;
  if (w.__arKeepActivePatched) return;
  w.__arKeepActivePatched = true;

  const define = (key: string, get: () => unknown) => {
    try {
      Object.defineProperty(Document.prototype, key, { configurable: true, get });
    } catch {
      /* 老浏览器忽略 */
    }
  };

  define('visibilityState', () => 'visible');
  define('hidden', () => false);
  define('webkitVisibilityState', () => 'visible');
  define('webkitHidden', () => false);

  const originalHasFocus = Document.prototype.hasFocus;
  try {
    Document.prototype.hasFocus = () => true;
  } catch {
    /* 忽略 */
  }

  const swallow = (e: Event) => e.stopImmediatePropagation();
  for (const type of ['visibilitychange', 'webkitvisibilitychange', 'freeze'] as const) {
    window.addEventListener(type, swallow, true);
  }
  window.addEventListener(
    'blur',
    (e) => {
      if (!(e.target instanceof Node)) e.stopImmediatePropagation();
    },
    true,
  );

  // 每 45s 造一次伪活动，避免长时间无输入被判空闲
  window.setInterval(() => {
    const root = document.documentElement;
    if (!root) return;
    if (originalHasFocus.call(document)) return;
    const init: MouseEventInit = { bubbles: true, clientX: 1, clientY: 1 };
    root.dispatchEvent(new MouseEvent('mousemove', init));
    if (typeof PointerEvent === 'function') root.dispatchEvent(new PointerEvent('pointermove', init));
  }, 45_000);

  // 拦截失败时续期 TTL（路由变更/页面重载后由 keep-active 自愈脚本重新打补丁）
  const renew = () => {
    try {
      sessionStorage.setItem('__ar_keep_active', String(Date.now() + 5 * 60 * 1000));
    } catch {
      /* 忽略 */
    }
  };
  renew();
  for (const type of ['visibilitychange', 'webkitvisibilitychange'] as const) {
    // 用 capture + 冒泡两个阶段都挂，确保即便被页面 stopImmediatePropagation 也续期一次
    window.addEventListener(type, renew, { capture: true });
  }
}
