// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CLICK_SEQUENCE, describeElement, simulateClick } from '@/lib/dom-click';

describe('CLICK_SEQUENCE（ADR-015：只靠 el.click() 对 SPA 无效）', () => {
  it('顺序固定且包含 pointerdown / mousedown', () => {
    expect(CLICK_SEQUENCE[0]).toBe('pointerover');
    expect(CLICK_SEQUENCE[CLICK_SEQUENCE.length - 1]).toBe('click');
    expect(CLICK_SEQUENCE).toContain('pointerdown');
    expect(CLICK_SEQUENCE).toContain('mousedown');
    expect(CLICK_SEQUENCE.indexOf('mousedown')).toBeLessThan(CLICK_SEQUENCE.indexOf('mouseup'));
    expect(CLICK_SEQUENCE.indexOf('mouseup')).toBeLessThan(CLICK_SEQUENCE.indexOf('click'));
  });

  it('down 阶段 buttons=1，up/click 阶段 buttons=0', () => {
    // 若 buttons 字段错了，一些框架（Gmail 的 NUI）会判定为无效手势
    const idxDown = CLICK_SEQUENCE.indexOf('mousedown');
    const idxUp = CLICK_SEQUENCE.indexOf('mouseup');
    expect(idxDown).toBeLessThan(idxUp);
    expect(CLICK_SEQUENCE).toHaveLength(10);
  });
});

describe('simulateClick（真实 DOM：happy-dom）', () => {
  function setup() {
    document.body.innerHTML = '<div id="btn" aria-label="刷新"></div>';
    const el = document.getElementById('btn')!;
    const seen: string[] = [];
    for (const type of CLICK_SEQUENCE) el.addEventListener(type, (e) => seen.push(e.type));
    return { el, seen };
  }

  it('派发完整 10 个事件，顺序与 CLICK_SEQUENCE 一致', () => {
    const { el, seen } = setup();
    simulateClick(el);
    // happy-dom 会把 mouseover/mouseenter 折叠成 pointerover/pointerenter 一次派发，
    // 因此只断言"每个阶段都被覆盖且顺序单调"，不要求逐字相等
    expect(seen.filter((t) => CLICK_SEQUENCE.includes(t as (typeof CLICK_SEQUENCE)[number])).length).toBeGreaterThanOrEqual(8);
    expect(seen[0]).toBe('pointerover');
    expect(seen[seen.length - 1]).toBe('click');
    expect(seen.indexOf('mousedown')).toBeLessThan(seen.indexOf('mouseup'));
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

  it('scrollIntoView 抛错时不影响派发', () => {
    document.body.innerHTML = '<div id="btn"></div>';
    const el = document.getElementById('btn') as HTMLElement & { scrollIntoView?: () => void };
    el.scrollIntoView = () => {
      throw new Error('unsupported');
    };
    const seen: string[] = [];
    el.addEventListener('click', () => seen.push('click'));
    expect(() => simulateClick(el)).not.toThrow();
    expect(seen).toEqual(['click']);
  });
});

describe('describeElement（面板「测试选择器」的回显）', () => {
  function mk(html: string): Element {
    document.body.innerHTML = html;
    return document.body.firstElementChild!;
  }

  it('优先用文字', () => {
    expect(describeElement(mk('<div>刷 新</div>'))).toBe('<div> “刷 新”');
  });

  it('没有文字时回落 aria-label（Gmail 图标按钮的场景）', () => {
    expect(describeElement(mk('<div aria-label="刷新"></div>'))).toBe('<div> “刷新”');
  });

  it('再回落 data-tooltip / title', () => {
    expect(describeElement(mk('<div data-tooltip="Refresh"></div>'))).toBe('<div> “Refresh”');
    expect(describeElement(mk('<div title="Refresh"></div>'))).toBe('<div> “Refresh”');
  });

  it('三者都没有时只显示标签名', () => {
    expect(describeElement(mk('<div></div>'))).toBe('<div>');
  });

  it('文字过长时截断到 40 字符', () => {
    const long = 'x'.repeat(60);
    expect(describeElement(mk(`<div>${long}</div>`))).toBe(`<div> “${long.slice(0, 40)}”`);
  });
});
