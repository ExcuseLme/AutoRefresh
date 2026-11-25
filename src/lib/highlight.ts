/**
 * 「测试选择器」的页内可视化反馈（ADR-031）
 *
 * 用户需求：点「测试选择器」时把页面滚动到目标元素可见，并给该元素一个**呼吸高亮**，
 * 让用户能确认自己选中的到底是哪个元素。
 *
 * 实现要点：
 *   - 覆盖层宿主 `pointer-events: none` + `z-index` 极高 ⇒ 不影响页面交互，也不会被
 *     `elementFromPoint` 命中（避免「测试」这一下反而挡住后续拾取）；
 *   - 样式装在 shadow root（`mode: 'closed'`）⇒ 页面 CSS 影响不到，也不需要给类名加前缀；
 *   - 呼吸效果用 CSS `@keyframes` 改变 `outline` 与 `background` 透明度，不做画布级动画；
 *   - 盒子位置每帧跟随（`requestAnimationFrame`）⇒ 兼容 `behavior: 'smooth'` 的滚动过程，
 *     以及页面上同时发生的布局变化。
 */

const HOST_ID = 'ar-highlight-host';

/**
 * 一次高亮的时长。呼吸动画 3 次（每次 800ms），共 2400ms。
 * 太短（<1.5s）用户可能正好在看别处而错过；太长会显得拖沓。
 */
const HIGHLIGHT_DURATION_MS = 2400;

const STYLE = `
.hi {
  position: fixed;
  pointer-events: none;
  border-radius: 3px;
  box-sizing: border-box;
  animation: ar-breath 800ms ease-in-out 3;
}
@keyframes ar-breath {
  0%   { outline: 2px solid rgba(99, 102, 241, 0); background: rgba(99, 102, 241, 0); }
  45%  { outline: 3px solid rgba(99, 102, 241, 1); background: rgba(99, 102, 241, 0.3); }
  100% { outline: 2px solid rgba(99, 102, 241, 0); background: rgba(99, 102, 241, 0); }
}
.badge {
  position: fixed;
  pointer-events: none;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(99, 102, 241, 0.95);
  color: #fff;
  font: 600 11px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  white-space: nowrap;
}
`;

type Surface = {
  host: HTMLElement;
  box: HTMLElement;
  badge: HTMLElement;
};

function createSurface(): Surface {
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  // 不用 inset:0 铺满：铺满虽然更省事，但会挡住整页的命中测试（在 ISOLATED world 里
  // 虽然 pointer-events:none 已经不挡，铺满仍会让某些页面的 elementFromPoint 变慢）。
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${STYLE}</style><div class="hi" hidden></div><div class="badge" hidden></div>`;
  document.documentElement.appendChild(host);

  return {
    host,
    box: root.querySelector('.hi') as HTMLElement,
    badge: root.querySelector('.badge') as HTMLElement,
  };
}

let activeCleanup: (() => void) | null = null;

/** 取消正在进行的高亮（重复点「测试」时先撤掉旧的，避免叠加多个盒子） */
export function stopHighlight(): void {
  const fn = activeCleanup;
  activeCleanup = null;
  fn?.();
}

/**
 * 把元素滚动到可视区中央，并给它一个呼吸高亮。
 *
 * @param el      目标元素（通常是 `querySelectorAll(selector)[0]`）
 * @param label   高亮旁的小标签文案（例如 `命中 1 个元素：<button> "刷新"`）
 */
export function highlightElement(el: Element, label?: string): void {
  stopHighlight();

  let surface: Surface;
  try {
    surface = createSurface();
  } catch {
    return; // 极少数情况下 attachShadow 不可用（老页面/受限环境）：静默跳过
  }

  // 1) 先滚动到可见区域（居中）。instant 而非 smooth —— 高亮要和元素位置一致，
  //    平滑滚动的中间帧虽然能用 rAF 跟随，但视觉上会"追着跑"，反而不如直接到位清楚。
  //    少数元素不支持该重载，忽略异常。
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  } catch {
    try {
      (el as HTMLElement).scrollIntoView?.();
    } catch {
      /* 忽略 */
    }
  }

  let rafId = 0;
  const follow = (): void => {
    const rect = el.getBoundingClientRect();
    // 元素被移出文档（页面重渲染）时提前收尾
    if (rect.width === 0 && rect.height === 0) {
      cleanup();
      return;
    }
    const { box, badge } = surface;
    box.hidden = false;
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    if (label) {
      badge.hidden = false;
      // 优先放在元素上方；上方空间不足时放到下沿
      const above = rect.top - 24;
      badge.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - 200))}px`;
      badge.style.top = `${above >= 4 ? above : Math.min(rect.bottom + 6, window.innerHeight - 24)}px`;
      badge.textContent = label;
    }
    rafId = requestAnimationFrame(follow);
  };

  const timer = window.setTimeout(cleanup, HIGHLIGHT_DURATION_MS);

  function cleanup(): void {
    if (timer) clearTimeout(timer);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    try {
      surface.host.remove();
    } catch {
      /* 页面可能已卸载 */
    }
    if (activeCleanup === cleanup) activeCleanup = null;
  }

  activeCleanup = cleanup;
  follow();
}
