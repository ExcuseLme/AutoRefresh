/**
 * 元素拾取器（页内覆盖层）。设计依据 docs/10 §1.5 / ADR-018 / ADR-030
 *
 * 为什么不用浏览器原生方案：
 *   - `chrome.devtools.inspectedWindow` 只在 devtools 页面可用，popup 调不到；
 *   - `chrome.debugger` + CDP `Overlay.setInspectMode` 能拿到 DevTools 原生高亮，
 *     但要 `debugger` 权限（"调试其他应用"重警告）、顶部常驻"正在调试此浏览器"横条、
 *     且与用户自己的 DevTools **互斥**（同一 tab 只能 attach 一个调试器）。
 *   对一个刻意收成"只有一个轻量面板"的自用扩展，这些代价远大于收益。
 *
 * 实现要点：
 *   - 宿主 `pointer-events: none`，否则 `elementFromPoint` 会命中我们自己（自我劫持）；
 *   - 样式装在 shadow root（mode: 'closed'）里，页面 CSS 影响不到；
 *   - 监听全部挂在 `window` 的**捕获阶段**，早于目标元素上的监听（防 stopImmediatePropagation）；
 *   - 确认选中后进入 **sweep 阶段**（ADR-030）：那一次手势剩余的 `pointerup`/`mouseup`/`click`
 *     也要被吞掉。否则用户"用来选元素"的这一下会穿透到真实页面，直接点中目标元素。
 */

import { generateSelector } from './selector';

const HOST_ID = 'ar-picker-host';

/** sweep 阶段的安全超时：万一 click 一直没来（按下后拖走/取消），也要能收尾 */
const SWEEP_TIMEOUT_MS = 400;

/**
 * sweep 阶段要吞掉的事件序列。mousedown/pointerdown 也在其中 ——
 * beginSweep 摘掉了 hover 的 pointerdown 监听，而 pointerdown 的 preventDefault
 * 不会抑制兼容性的 mousedown，不补回来就会漏到页面上。
 */
const SWEEP_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick'] as const;

type PickerCallbacks = {
  /** 用户确认选中：带回生成的 selector 与元素摘要 */
  onPick: (selector: string, preview: string) => void;
  /** 用户取消（Esc / 右键） */
  onCancel: (reason?: string) => void;
};

let activeCleanup: (() => void) | null = null;

/** 拾取器是否正在运行 */
export function isPickerActive(): boolean {
  return activeCleanup !== null;
}

/** 强制停止（页面导航走、SW 要求停止、开始新一轮时都用它） */
export function stopPicker(): void {
  const fn = activeCleanup;
  activeCleanup = null;
  fn?.();
}

const STYLE = `
.overlay { position: fixed; inset: 0; pointer-events: none; }
.box {
  position: fixed; pointer-events: none;
  background: rgba(99, 102, 241, 0.16);
  outline: 2px solid #6366f1;
  outline-offset: -2px;
  border-radius: 2px;
}
.tip {
  position: fixed; pointer-events: none;
  max-width: 420px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(24, 24, 27, 0.95);
  color: #fafafa;
  font: 500 12px/1.45 -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  word-break: break-all;
}
.tip .tag { color: #d4d4d8; }
.tip .sel { color: #a5b4fc; font-family: ui-monospace, "Cascadia Code", Consolas, monospace; margin-top: 2px; }
.tip .meta { margin-top: 4px; color: #a1a1aa; font-weight: 400; }
.tip .warn { color: #fbbf24; font-weight: 400; }
.tip .ok { color: #34d399; font-weight: 400; }
`;

type Host = {
  host: HTMLElement;
  box: HTMLElement;
  tip: HTMLElement;
};

function createHost(): Host {
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${STYLE}</style><div class="overlay"><div class="box"></div><div class="tip"></div></div>`;
  document.documentElement.appendChild(host);

  const box = root.querySelector('.box') as HTMLElement;
  const tip = root.querySelector('.tip') as HTMLElement;
  box.style.display = 'none';
  tip.style.display = 'none';
  return { host, box, tip };
}

/** 元素是否值得作为拾取目标 */
function isPickable(el: Element | null): el is Element {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === 'HTML' || tag === 'BODY') return false;
  if (el.closest(`#${HOST_ID}`)) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 元素摘要（与 dom-click 的 describeElement 同口径，这里只需要短版本） */
function summarize(el: Element): string {
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  const label =
    el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('title') || '';
  const tagName = el.tagName.toLowerCase();
  const name = text || label;
  return name ? `<${tagName}> “${name.slice(0, 30)}”` : `<${tagName}>`;
}

/**
 * 启动拾取器。
 * @returns 是否成功启动（已有拾取器时会先停旧的，幂等）
 */
export function startPicker(cb: PickerCallbacks): boolean {
  stopPicker();

  let surface: Host;
  try {
    surface = createHost();
  } catch {
    return false;
  }

  let rafId = 0;
  let lastTarget: Element | null = null;
  let lastClientX = 0;
  let lastClientY = 0;

  /**
   * 生命周期（ADR-030）
   *   hover：正在高亮跟随鼠标，等待用户点一下
   *   sweep：已经选中，但用户这一下的 pointerup/mouseup/click 还没发完 ——
   *          继续吞掉，**不让它穿透到真实页面**
   *   torn ：全部拆掉，结束
   */
  let phase: 'hover' | 'sweep' | 'torn' = 'hover';
  let sweepTimer: ReturnType<typeof setTimeout> | 0 = 0;

  const paint = (target: Element | null): void => {
    if (!target) {
      surface.box.style.display = 'none';
      surface.tip.style.display = 'none';
      return;
    }

    const rect = target.getBoundingClientRect();
    const box = surface.box;
    box.style.display = 'block';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const r = generateSelector(target);

    const tip = surface.tip;
    const left = Math.max(8, Math.min(lastClientX + 16, window.innerWidth - 434));
    const top = Math.max(8, Math.min(lastClientY + 16, window.innerHeight - 96));
    tip.style.display = 'block';
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;

    const notes: string[] = [];
    if (r.shadow) notes.push('<span class="warn">该元素在 Shadow DOM 内，暂不支持</span>');
    else if (r.long) notes.push('<span class="warn">选择器较长，页面结构变化后可能失效</span>');
    else notes.push('<span class="ok">点击即为该元素生成选择器</span>');

    tip.innerHTML =
      `<span class="tag">${escapeHtml(summarize(target))}</span>` +
      `<div class="sel">${escapeHtml(r.selector || "（无法生成）")}</div>` +
      `<div class="meta">${notes.join(' ')}</div>`;
  };

  const hitTest = (x: number, y: number): Element | null => {
    const hit = document.elementFromPoint(x, y);
    return isPickable(hit) ? hit : null;
  };

  /** 拦截事件，使其既不触发页面默认行为，也不触发页面上的监听 */
  const swallow = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  // ────────────────────────────────────────────── hover 阶段

  const onMove = (e: MouseEvent): void => {
    if (phase !== 'hover') return;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    if (rafId) return; // rAF 节流：mousemove 频率可能上千 Hz
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const target = hitTest(lastClientX, lastClientY);
      // 同一目标也要重画（卡片跟随鼠标）
      if (target !== lastTarget || target) {
        lastTarget = target;
        paint(target);
      }
    });
  };

  const onPickDown = (e: Event): void => {
    if (phase !== 'hover') return;
    swallow(e);

    const me = e as MouseEvent;
    const target = hitTest(me.clientX, me.clientY);
    if (!target) return;

    const r = generateSelector(target);
    // 不支持的目标：不确认，保持拾取状态（用户可继续移动或按 Esc）
    if (!r.selector || r.shadow) return;

    // 选中了：进入 sweep，把这次手势剩下的 pointerup/mouseup/click 也吞掉
    beginSweep();
    cb.onPick(r.selector, summarize(target));
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (phase !== 'hover') return;
    if (e.key !== 'Escape') return;
    swallow(e);
    cancel('escape');
  };

  const onContextMenu = (e: Event): void => {
    swallow(e);
    if (phase !== 'hover') return;
    cancel('contextmenu');
  };

  const onBlur = (): void => {
    if (phase !== 'hover') return;
    // 窗口失焦（点到浏览器外/切走）：只清高亮，**不要拆掉拾取器**
    paint(null);
    lastTarget = null;
  };

  /**
   * 页面被导航走 / 即将卸载：清理自己的 UI 与监听，并**告知 SW**（best-effort）。
   *
   * 注意：这里**不监听 `visibilitychange`**。实测（2026-11-24）早期版本把
   * `visibilitychange` 当成卸载信号，导致用户切一下标签页、切回来时
   * 拾取器已经静默消失，而 SW 里的 `pickerTabId` 还残留 —— 状态不一致。
   * 切标签页只意味着"暂时看不见"，拾取态应当保留。
   */
  const onPageHide = (): void => {
    if (phase === 'torn') return;
    const wasHover = phase === 'hover';
    phase = 'torn';
    teardown();
    if (wasHover) cb.onCancel('navigated');
  };

  // ────────────────────────────────────────────── sweep 阶段
  //
  // ADR-030 的核心：`pointerdown` 的默认行为被 preventDefault 取消后，
  // 浏览器**仍会**继续派发 `mouseup` 与 `click`。而 hover 阶段的点击拦截器
  // 在 onPickDown 里就被拆掉了，所以"用来选元素的那一下"会落到真实页面上，
  // 把目标元素真的点一次（用户看到的现象就是"选元素时直接把页面按钮点了"）。
  // 修法：先把 hover 的监听换成 sweep 的监听（仍然全部 swallow），
  // 等 click 发完（或超时）再真正拆掉。

  const onSweepEvent = (e: Event): void => {
    swallow(e);
    // click 是这串事件的最后一个；吞掉它就可以收尾了
    if (e.type === 'click') endSweep();
  };

  const beginSweep = (): void => {
    phase = 'sweep';
    // 高亮与十字准星立即撤掉（用户已经选完了，不该再看到"还在选"）
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    paint(null);
    document.documentElement.style.cursor = '';
    try {
      surface.host.remove();
    } catch {
      /* 页面可能已卸载 */
    }

    // hover 的这几项不再需要
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mousedown', onPickDown, true);
    window.removeEventListener('pointerdown', onPickDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', onBlur, true);
    window.removeEventListener('click', swallow, true);
    window.removeEventListener('dblclick', swallow, true);

    /*
     * 继续吞掉本次手势的剩余事件。
     *
     * 注意 `mousedown` / `pointerdown` 也必须在列表里：
     * `pointerdown` 上 `preventDefault()` **不会**抑制兼容性的 `mousedown`，
     * 而我们在 beginSweep 里刚把 hover 的 pointerdown 监听摘掉了 ——
     * 不补回来的话，紧随其后的 `mousedown` 会落到真实页面（有些页面就是在 mousedown 上做事的）。
     */
    for (const type of SWEEP_EVENTS) window.addEventListener(type, onSweepEvent, true);

    // 兜底：按下后拖走导致 click 永远不来时，也要能收尾
    sweepTimer = setTimeout(endSweep, SWEEP_TIMEOUT_MS);
  };

  const endSweep = (): void => {
    if (phase === 'torn') return;
    phase = 'torn';
    teardown();
  };

  /** 用户主动取消（Esc / 右键） */
  const cancel = (reason: string): void => {
    if (phase === 'torn') return;
    phase = 'torn';
    teardown();
    cb.onCancel(reason);
  };

  // ────────────────────────────────────────────── 拆解

  function teardown(): void {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (sweepTimer) {
      clearTimeout(sweepTimer);
      sweepTimer = 0;
    }

    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mousedown', onPickDown, true);
    window.removeEventListener('pointerdown', onPickDown, true);
    window.removeEventListener('click', swallow, true);
    window.removeEventListener('dblclick', swallow, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', onBlur, true);
    window.removeEventListener('pagehide', onPageHide, true);

      for (const type of SWEEP_EVENTS) window.removeEventListener(type, onSweepEvent, true);

    document.documentElement.style.cursor = '';
    try {
      surface.host.remove();
    } catch {
      /* 页面已卸载 */
    }
    activeCleanup = null;
  }

  // ────────────────────────────────────────────── 装监听

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mousedown', onPickDown, true);
  window.addEventListener('pointerdown', onPickDown, true);
  window.addEventListener('click', swallow, true);
  window.addEventListener('dblclick', swallow, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', onBlur, true);
  window.addEventListener('pagehide', onPageHide, true);

  // 十字准星（DevTools 的选择模式也是十字）
  document.documentElement.style.cursor = 'crosshair';

  // 强制停止：无论当前处于哪个阶段都要拆干净
  activeCleanup = () => {
    if (phase === 'torn') return;
    phase = 'torn';
    teardown();
  };

  paint(null);
  return true;
}
