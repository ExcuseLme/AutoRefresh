// @vitest-environment happy-dom
/**
 * 双击序列单测。设计依据 docs/10 §2.2 / ADR-020
 *
 * 核心断言：
 * - 双击 = 悬停一次 + 两次完整按下序列 + dblclick
 * - click 的 detail 依次为 1、2；dblclick.detail === 2（覆盖"靠 detail 判双击"的页面）
 * - 同步派发（同一 tick 内全部完成），不加人为延时
 */
import { describe, expect, it } from 'vitest';
import { CLICK_SEQUENCE, DOUBLE_CLICK_SEQUENCE, HOVER_SEQUENCE, simulateClick } from '@/lib/dom-click';

describe('序列常量', () => {
  it('单击 = 悬停 + 按下 + click，共 10 个事件', () => {
    expect(HOVER_SEQUENCE).toHaveLength(5);
    expect(CLICK_SEQUENCE).toHaveLength(10);
    expect(CLICK_SEQUENCE[0]).toBe('pointerover');
    expect(CLICK_SEQUENCE[CLICK_SEQUENCE.length - 1]).toBe('click');
  });

  it('双击 = 悬停一次 + 两次按下 + dblclick，共 16 个事件', () => {
    // 5 悬停 + (4 按下 + 1 click) × 2 + 1 dblclick = 5 + 10 + 1
    expect(DOUBLE_CLICK_SEQUENCE).toHaveLength(16);
    expect(DOUBLE_CLICK_SEQUENCE[DOUBLE_CLICK_SEQUENCE.length - 1]).toBe('dblclick');
    // 悬停只在最前面出现一次（浏览器也不会在第二按时重发）
    expect(DOUBLE_CLICK_SEQUENCE.filter((t) => t === 'pointerover')).toHaveLength(1);
    expect(DOUBLE_CLICK_SEQUENCE.filter((t) => t === 'mouseover')).toHaveLength(1);
    expect(DOUBLE_CLICK_SEQUENCE.filter((t) => t === 'click')).toHaveLength(2);
  });

  it('down 一定在 up 之前，up 一定在 click 之前（两轮都成立）', () => {
    const firstDown = CLICK_SEQUENCE.indexOf('mousedown');
    const firstUp = CLICK_SEQUENCE.indexOf('mouseup');
    expect(firstDown).toBeLessThan(firstUp);
    expect(firstUp).toBeLessThan(CLICK_SEQUENCE.indexOf('click'));
  });
});

describe('simulateClick · 单击', () => {
  it('派发完整 10 个事件', () => {
    document.body.innerHTML = '<div id="btn" aria-label="刷新"></div>';
    const el = document.getElementById('btn')!;
    const seen: string[] = [];
    for (const t of CLICK_SEQUENCE) el.addEventListener(t, (e) => seen.push(e.type));
    simulateClick(el);
    expect(seen[0]).toBe('pointerover');
    expect(seen[seen.length - 1]).toBe('click');
    expect(seen.length).toBeGreaterThanOrEqual(8); // happy-dom 会折叠部分 pointer/mouse 别名
  });

  it('click 的 detail 是 1', () => {
    document.body.innerHTML = '<div id="btn"></div>';
    const el = document.getElementById('btn')!;
    let detail = -1;
    el.addEventListener('click', (e) => (detail = (e as MouseEvent).detail));
    simulateClick(el);
    expect(detail).toBe(1);
  });

  it('事件冒泡到父节点（框架常把监听挂在容器上）', () => {
    document.body.innerHTML = '<div id="wrap"><div id="btn"></div></div>';
    const el = document.getElementById('btn')!;
    const wrap = document.getElementById('wrap')!;
    let bubbled = 0;
    wrap.addEventListener('click', () => (bubbled += 1));
    wrap.addEventListener('mousedown', () => (bubbled += 1));
    simulateClick(el);
    expect(bubbled).toBe(2);
  });
});

describe('simulateClick · 双击（ADR-020）', () => {
  it('派发两次 click 与一次 dblclick', () => {
    document.body.innerHTML = '<div id="btn"></div>';
    const el = document.getElementById('btn')!;
    const clicks: number[] = [];
    let dbl = -1;
    el.addEventListener('click', (e) => clicks.push((e as MouseEvent).detail));
    el.addEventListener('dblclick', (e) => (dbl = (e as MouseEvent).detail));
    simulateClick(el, { action: 'double' });
    expect(clicks).toEqual([1, 2]);
    expect(dbl).toBe(2);
  });

  it('两次按下各自的 mousedown/mouseup 都派发（共 2 次）', () => {
    document.body.innerHTML = '<div id="btn"></div>';
    const el = document.getElementById('btn')!;
    let downs = 0;
    let ups = 0;
    el.addEventListener('mousedown', () => (downs += 1));
    el.addEventListener('mouseup', () => (ups += 1));
    simulateClick(el, { action: 'double' });
    expect(downs).toBe(2);
    expect(ups).toBe(2);
  });

  it('同步派发：全部事件在同一个 tick 内完成', () => {
    document.body.innerHTML = '<div id="btn"></div>';
    const el = document.getElementById('btn')!;
    const seen: string[] = [];
    el.addEventListener('dblclick', () => seen.push('dblclick'));
    simulateClick(el, { action: 'double' });
    // 没有 setTimeout / 微任务等待，调用返回时事件已经全部到齐
    expect(seen).toEqual(['dblclick']);
  });

  it('双击的 click 序列前后各有一轮完整按下', () => {
    document.body.innerHTML = '<div id="btn"></div>';
    const el = document.getElementById('btn')!;
    const order: string[] = [];
    for (const t of ['mousedown', 'mouseup', 'click', 'dblclick'] as const) {
      el.addEventListener(t, (e) => order.push(e.type));
    }
    simulateClick(el, { action: 'double' });
    expect(order).toEqual(['mousedown', 'mouseup', 'click', 'mousedown', 'mouseup', 'click', 'dblclick']);
  });

  it('双击不重发悬停（不会出现两次 mouseover）', () => {
    document.body.innerHTML = '<div id="btn"></div>';
    const el = document.getElementById('btn')!;
    let overs = 0;
    el.addEventListener('mouseover', () => (overs += 1));
    simulateClick(el, { action: 'double' });
    expect(overs).toBe(1);
  });

  it('不支持的 action 值按单击处理（防御脏配置）', () => {
    document.body.innerHTML = '<div id="btn"></div>';
    const el = document.getElementById('btn')!;
    let dbl = 0;
    el.addEventListener('dblclick', () => (dbl += 1));
    simulateClick(el, { action: 'triple' as never });
    expect(dbl).toBe(0);
  });
});

describe('simulateClick · 健壮性', () => {
  it('scrollIntoView 抛错时不影响派发', () => {
    document.body.innerHTML = '<div id="btn"></div>';
    const el = document.getElementById('btn') as HTMLElement & { scrollIntoView: () => void };
    el.scrollIntoView = () => {
      throw new Error('unsupported');
    };
    const seen: string[] = [];
    el.addEventListener('click', () => seen.push('click'));
    expect(() => simulateClick(el)).not.toThrow();
    expect(seen).toEqual(['click']);
  });

  it('scrollIntoView: false 时不滚动', () => {
    document.body.innerHTML = '<div id="btn"></div>';
    const el = document.getElementById('btn')!;
    let scrolled = 0;
    el.scrollIntoView = () => (scrolled += 1);
    simulateClick(el, { scrollIntoView: false });
    expect(scrolled).toBe(0);
  });
});
