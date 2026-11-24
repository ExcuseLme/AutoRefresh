/**
 * 页面内"模拟真实点击"的实现。设计依据 docs/05 §7（ADR-015）
 *
 * 为什么不能只用 `el.click()`：
 *   2026-11-24 实测 Gmail 收件箱的刷新按钮（`[aria-label="刷新"]`）：
 *     - `el.click()`                → 每轮 0 次网络请求（页面完全不理）
 *     - 完整 pointer/mouse 序列     → 每轮 1 次 `/sync/u/0/i/s` 请求
 *   原因是大量 SPA（Gmail / 网易邮箱 / React / Vue 后台）把交互逻辑挂在
 *   `pointerdown` / `mousedown` 上，而非 `click`；合成 click 进不去。
 *
 * 局限：合成事件的 `isTrusted` 恒为 false，无法伪造。对绝大多数页面够用，
 * 但对把 `isTrusted` 当作硬性门槛的页面无效（这是合成点击的能力上限，非本扩展缺陷）。
 */

/** 浏览器真实点击的事件派发顺序（缺一不可，顺序也不能乱） */
export const CLICK_SEQUENCE = [
  'pointerover',
  'pointerenter',
  'mouseover',
  'mouseenter',
  'mousemove',
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
  'click',
] as const;

export type ClickSequenceStep = (typeof CLICK_SEQUENCE)[number];

/**
 * 在目标元素上派发完整点击序列。
 *
 * 不传 `view` 会拿不到 `window`，部分框架的合成事件系统会因此判定无效，
 * 所以所有事件都带 `bubbles/cancelable/view`，down/up 分别带 `buttons: 1 / 0`。
 */
export function simulateClick(el: Element, view: Window | null = globalThis.window ?? null): void {
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  } catch {
    /* 少数元素不支持 scrollIntoView 参数，忽略 */
  }

  const base = { bubbles: true, cancelable: true, view: view ?? undefined, button: 0 };

  const dispatchPointer = (type: string, extra: PointerEventInit = {}) => {
    const Ctor = globalThis.PointerEvent;
    if (typeof Ctor !== 'function') return; // 老环境没有 PointerEvent，跳过（mouse 事件仍然会发）
    try {
      el.dispatchEvent(
        new Ctor(type, { ...base, pointerId: 1, isPrimary: true, pointerType: 'mouse', ...extra }),
      );
    } catch {
      /* 忽略构造失败（极少数环境对 PointerEventInit 校验很严） */
    }
  };

  const dispatchMouse = (type: string, extra: MouseEventInit = {}) => {
    el.dispatchEvent(new MouseEvent(type, { ...base, ...extra }));
  };

  for (const step of CLICK_SEQUENCE) {
    switch (step) {
      case 'pointerover':
      case 'pointerenter':
        dispatchPointer(step);
        break;
      case 'pointerdown':
        dispatchPointer(step, { buttons: 1 });
        break;
      case 'pointerup':
        dispatchPointer(step, { buttons: 0 });
        break;
      case 'mousedown':
        dispatchMouse(step, { buttons: 1 });
        break;
      case 'mousemove':
      case 'mouseup':
      case 'click':
        dispatchMouse(step);
        break;
      default:
        break;
    }
  }
}

/**
 * 选择器命中元素的摘要（面板「测试选择器」回显用）。
 *
 * 摘要优先级：可见文字 → `aria-label` / `data-tooltip` / `title` → 标签名。
 * 像 Gmail 的刷新按钮只有图标、没有文字，只能靠 `aria-label` 认出来。
 */
export function describeElement(el: Element): string {
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  const label =
    el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('title') || '';
  const tag = el.tagName.toLowerCase();
  const name = text || label;
  if (!name) {
    const id = el.id ? ` #${el.id}` : '';
    return `<${tag}${id}>`;
  }
  return `<${tag}> “${name.slice(0, 40)}”`;
}
