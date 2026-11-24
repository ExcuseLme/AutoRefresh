/**
 * 页面内「模拟真实点击」的实现。设计依据 docs/05 §7.2（ADR-015 / ADR-020）
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

import type { ClickAction } from './options';

/** 真实单击之前的"悬停铺垫"（浏览器在按下前一定会先发这些） */
export const HOVER_SEQUENCE = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'] as const;

/** 一次"按下-抬起"完整序列（click 的 detail 由调用方决定） */
export const PRESS_SEQUENCE = [
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
] as const;

/** 单击的全部事件（不含 click，由 dispatchPress 补） */
export const CLICK_SEQUENCE = [...HOVER_SEQUENCE, ...PRESS_SEQUENCE, 'click'] as const;

/** 双击的全部事件：悬停一次 + 两次完整按下 + dblclick（ADR-020） */
export const DOUBLE_CLICK_SEQUENCE = [
  ...HOVER_SEQUENCE,
  ...PRESS_SEQUENCE,
  'click',
  ...PRESS_SEQUENCE,
  'click',
  'dblclick',
] as const;

export type ClickSequenceStep = (typeof DOUBLE_CLICK_SEQUENCE)[number];

type DispatchOptions = {
  /** 单击还是双击（默认单击） */
  action?: ClickAction;
  /** 事件所属的 window；缺省用 globalThis.window */
  view?: Window | null;
  /** 是否先滚动到可视区（默认 true） */
  scrollIntoView?: boolean;
};

/**
 * 在目标元素上派发完整点击序列。
 *
 * 不传 `view` 会拿不到 `window`，部分框架的合成事件系统会因此判定无效，
 * 所以所有事件都带 `bubbles/cancelable/view`；down/up 分别带 `buttons: 1 / 0`
 * （写错会被部分框架判为无效手势）。
 *
 * 双击**同步派发**、不加人为延时（ADR-020）：真实双击判定窗口约 400ms，
 * 0ms 间隔必然落在窗口内；而 `setTimeout` 反而给页面机会在两次点击之间重渲染，
 * 第二次可能打到已脱离文档的元素。
 */
export function simulateClick(el: Element, opts: DispatchOptions = {}): void {
  const action: ClickAction = opts.action ?? 'single';
  const view = opts.view === undefined ? (globalThis.window ?? null) : opts.view;

  if (opts.scrollIntoView !== false) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    } catch {
      /* 少数元素不支持 scrollIntoView 参数，忽略 */
    }
  }

  const base = { bubbles: true, cancelable: true, view: view ?? undefined, button: 0 };

  const dispatchPointer = (type: string, extra: PointerEventInit = {}): void => {
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

  const dispatchMouse = (type: string, extra: MouseEventInit = {}): void => {
    el.dispatchEvent(new MouseEvent(type, { ...base, ...extra }));
  };

  const hover = (): void => {
    dispatchPointer('pointerover');
    dispatchPointer('pointerenter');
    dispatchMouse('mouseover');
    dispatchMouse('mouseenter');
    dispatchMouse('mousemove');
  };

  /** 一次完整按下-抬起；clickCount 会写进 click / dblclick 的 detail */
  const press = (clickCount: number): void => {
    dispatchPointer('pointerdown', { buttons: 1 });
    dispatchMouse('mousedown', { buttons: 1 });
    dispatchPointer('pointerup', { buttons: 0 });
    dispatchMouse('mouseup', { buttons: 0 });
    dispatchMouse('click', { detail: clickCount });
  };

  hover();
  press(1);
  if (action === 'double') {
    // 第二按不重发悬停（浏览器也不会）
    press(2);
    dispatchMouse('dblclick', { detail: 2 });
  }
}

/**
 * 选择器命中元素的摘要（面板「测试选择器」与拾取器回显用）。
 *
 * 摘要优先级：可见文字 → `aria-label` / `data-tooltip` / `title` → 标签名（带 id）。
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
