// @vitest-environment happy-dom
/**
 * 元素拾取器的"点击不穿透"测试（ADR-030）
 *
 * 复现用户的 bug：
 *   在「选择元素」模式下，为了选某个元素而点的那一下，会**真的把页面上的该元素点一次**。
 *   选中手势只应该用于生成 selector，不应穿透到真实页面。
 *
 * 真实浏览器的派发顺序（一次左键点击）：
 *   pointerdown → mousedown → pointerup → mouseup → click
 * `pointerdown` 上 `preventDefault()` 只抑制**后续的兼容事件是否作为默认动作**，
 * 但 `mousedown`/`mouseup`/`click` 仍会被派发；所以拾取器必须在整串事件上持续介入。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPicker, stopPicker, isPickerActive } from '@/lib/picker';

/** 一次完整左键点击的事件序列（按真实浏览器顺序） */
const CLICK_SEQUENCE = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const;

function makeTarget(): { el: HTMLButtonElement; hits: string[] } {
  const el = document.createElement('button');
  el.textContent = 'refresh';
  document.body.appendChild(el);

  // 让元素有非零尺寸（isPickable 会检查）
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ left: 10, top: 10, width: 100, height: 30, right: 110, bottom: 40, x: 10, y: 10 }),
  });

  const hits: string[] = [];
  for (const type of CLICK_SEQUENCE) {
    el.addEventListener(type, () => hits.push(type));
  }
  return { el, hits };
}

function fireSequence(target: Element, type: string): void {
  const init = { bubbles: true, cancelable: true, clientX: 50, clientY: 25 };
  if (type.startsWith('pointer')) {
    target.dispatchEvent(new PointerEvent(type, init));
  } else {
    target.dispatchEvent(new MouseEvent(type, init));
  }
}

beforeEach(() => {
  // happy-dom 的 elementFromPoint 恒为 null，这里指到我们要测的那个元素
  let current: Element | null = null;
  (globalThis as unknown as { __setPickHit: (e: Element | null) => void }).__setPickHit = (e) => {
    current = e;
  };
  document.elementFromPoint = () => current;
});

afterEach(() => {
  stopPicker();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('拾取器：选中手势不穿透到页面（ADR-030）', () => {
  it('选中元素后，这一下 click 不应触发页面上的监听', () => {
    const { el, hits } = makeTarget();
    const setHit = (globalThis as unknown as { __setPickHit: (e: Element | null) => void }).__setPickHit;

    let picked: string | null = null;
    expect(
      startPicker({
        onPick: (sel) => {
          picked = sel;
        },
        onCancel: () => {},
      }),
    ).toBe(true);

    // 鼠标移上去 → 高亮该元素
    setHit(el);
    fireSequence(el, 'pointerdown'); // ← 用来选元素的那一下

    expect(picked).toBeTruthy();
    expect(hits).toEqual([]); // pointerdown 已被吞掉

    // 紧接着这次手势剩余的事件：都必须被吞掉，一个都不能落到页面
    fireSequence(el, 'mousedown');
    fireSequence(el, 'pointerup');
    fireSequence(el, 'mouseup');
    fireSequence(el, 'click');

    expect(hits).toEqual([]);
  });

  it('sweep 结束后拾取器完全退出（监听已拆，页面恢复可点）', async () => {
    const { el, hits } = makeTarget();
    const setHit = (globalThis as unknown as { __setPickHit: (e: Element | null) => void }).__setPickHit;

    startPicker({ onPick: () => {}, onCancel: () => {} });
    setHit(el);
    fireSequence(el, 'pointerdown');
    fireSequence(el, 'mousedown');
    fireSequence(el, 'pointerup');
    fireSequence(el, 'mouseup');
    fireSequence(el, 'click'); // 这一步会 endSweep

    expect(isPickerActive()).toBe(false);

    // 之后页面上的点击必须正常生效（不能因为拾取器残留而被永久吞掉）
    fireSequence(el, 'click');
    expect(hits).toEqual(['click']);
  });

  it('未选中的 hover 阶段也不让事件穿透', () => {
    const { el, hits } = makeTarget();
    const setHit = (globalThis as unknown as { __setPickHit: (e: Element | null) => void }).__setPickHit;

    startPicker({ onPick: () => {}, onCancel: () => {} });
    setHit(el);
    // hover 阶段的 click 直接吞掉（不会误点页面）
    fireSequence(el, 'click');
    expect(hits).toEqual([]);
  });

  it('hits 元素为 null 时点击不确认、继续停留在 hover 阶段', () => {
    const { el, hits } = makeTarget();
    const setHit = (globalThis as unknown as { __setPickHit: (e: Element | null) => void }).__setPickHit;
    const onPick = vi.fn();

    startPicker({ onPick, onCancel: () => {} });
    setHit(null);
    fireSequence(el, 'pointerdown');

    expect(onPick).not.toHaveBeenCalled();
    expect(isPickerActive()).toBe(true);
    expect(hits).toEqual([]);
  });
});
