// @vitest-environment happy-dom
/**
 * 选择器生成器单测。设计依据 docs/10 §1.6 / ADR-019
 *
 * 断言的是"算法不变式"，不是某个固定输出：
 * - **不管哪一层命中，生成的 selector 必须唯一命中目标元素**（最重要的一条）
 * - 语义属性优先于结构路径（用户已确认的优先级）
 * - 动态 id / 状态类 / 框架前缀不参与生成
 * - 结构路径会被最小化，且优先用"tag + 稳定 class"而不是纯 nth-of-type
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { isStableName, isUniqueFor, generateSelector, isInShadowDom } from '@/lib/selector';

/** 用 HTML 重置文档（每次测试独立） */
function setHtml(html: string): void {
  document.body.innerHTML = html;
}

/** 断言生成结果确实唯一命中 target */
function expectRoundTrip(target: Element): ReturnType<typeof generateSelector> {
  const r = generateSelector(target);
  expect(r.selector).toBeTruthy();
  expect(isUniqueFor(r.selector, target), `selector 未唯一命中：${r.selector}`).toBe(true);
  return r;
}

beforeEach(() => {
  setHtml('');
});

describe('isStableName（稳定性启发式）', () => {
  it('普通语义化名字通过', () => {
    expect(isStableName('dvContainer')).toBe(true);
    expect(isStableName('js-component-button')).toBe(true);
    expect(isStableName('nui-btn')).toBe(true);
  });

  it('动态 id（3+ 连续数字）被拒（网易邮箱的实测样本）', () => {
    expect(isStableName('_mail_button_228_1148')).toBe(false);
    expect(isStableName('_mail_toolbar_7_997')).toBe(false);
    expect(isStableName('el-1795508820124')).toBe(false);
  });

  it('构建产物前缀被拒', () => {
    expect(isStableName('css-1a2b3c')).toBe(false);
    expect(isStableName('sc-bdVaJa')).toBe(false);
    expect(isStableName('emotion-abc')).toBe(false);
    expect(isStableName('data-v-1234')).toBe(false);
  });

  it('状态类后缀被拒（会随交互变化）', () => {
    expect(isStableName('active')).toBe(false);
    expect(isStableName('card-loading')).toBe(false);
    expect(isStableName('is-selected')).toBe(false);
    expect(isStableName('btn-hovered')).toBe(false);
  });

  it('需要转义的字符被拒', () => {
    expect(isStableName('text-[13px]')).toBe(false);
    expect(isStableName('w:1/2')).toBe(false);
  });

  it('过长名字被拒', () => {
    expect(isStableName('x'.repeat(41))).toBe(false);
  });

  it('空名 / 极短名 / 哈希尾巴被拒', () => {
    expect(isStableName('')).toBe(false);
    expect(isStableName('ab')).toBe(false);
    expect(isStableName('Button-root-1a2b3c')).toBe(false);
  });
});

describe('T0 语义属性优先（用户已确认的优先级）', () => {
  it('aria-label 唯一时直接用它（Gmail 刷新按钮的场景）', () => {
    setHtml(`
      <div id="wrap">
        <div role="button" aria-label="刷新"></div>
        <div role="button" aria-label="更多"></div>
      </div>`);
    const target = document.querySelector('[aria-label="刷新"]')!;
    const r = expectRoundTrip(target);
    expect(r.tier).toBe('semantic');
    expect(r.selector).toBe('[aria-label="刷新"]');
  });

  it('aria-label 命中多个时降级到结构路径并加 tag 前缀', () => {
    setHtml(`
      <div><span aria-label="x"></span></div>
      <div><div aria-label="x"></div></div>`);
    const spans = document.querySelector('span')!;
    const r = expectRoundTrip(spans);
    // 唯一化靠 tag 前缀即可（div 与 span 区分）
    expect(r.tier).toBe('semantic');
    expect(r.selector.includes('span')).toBe(true);
  });

  it('树里有多处相同 aria-label 且同 tag 时，继续降级到结构路径', () => {
    setHtml(`
      <div><div><span aria-label="刷新"></span></div></div>
      <div><div><span aria-label="刷新"></span></div></div>`);
    const first = document.querySelectorAll('[aria-label="刷新"]')[0]!;
    const r = expectRoundTrip(first);
    // 只要唯一即可；tier 可能是 semantic(withTag) 或 path
    expect(r.unique).toBe(true);
  });

  it('data-tooltip / title / placeholder / alt / name 也属于 T0', () => {
    setHtml(`
      <img alt="咪咕音乐">
      <input placeholder="搜索">
      <div data-tooltip="刷新"></div>
      <div title="标题"></div>
      <input name="q2">`);
    expect(expectRoundTrip(document.querySelector('img')!).selector).toBe('[alt="咪咕音乐"]');
    expect(expectRoundTrip(document.querySelector('input[placeholder]')!).selector).toBe(
      '[placeholder="搜索"]',
    );
    expect(expectRoundTrip(document.querySelector('[data-tooltip]')!).selector).toBe(
      '[data-tooltip="刷新"]',
    );
    expect(expectRoundTrip(document.querySelector('[title]')!).selector).toBe('[title="标题"]');
    expect(expectRoundTrip(document.querySelector('[name="q2"]')!).selector).toBe('[name="q2"]');
  });

  it('语义属性值带引号时安全降级（不抛错、仍得到唯一 selector）', () => {
    // 真实 Chrome 支持 `\"` 转义；happy-dom 不支持，会抛语法错误。
    // 两条路径都必须走到"唯一命中"，这正是 isUniqueFor 里 try/catch 的意义。
    setHtml('<div aria-label=\'say "hi"\'></div>');
    const target = document.querySelector('div')!;
    const r = expectRoundTrip(target);
    expect(r.selector).toBeTruthy();
  });
});

describe('T1 结构路径（含最小化）', () => {
  it('没有语义属性时用结构路径，且能被最小化', () => {
    setHtml(`
      <div class="page">
        <div class="toolbar">
          <button class="refresh">刷新</button>
          <button class="more">更多</button>
        </div>
      </div>`);
    const target = document.querySelector('button.refresh')!;
    const r = expectRoundTrip(target);
    expect(['path', 'class', 'combined', 'semantic']).toContain(r.tier);
    // 关键：不需要从 body 一路写下来
    expect(r.selector).not.toMatch(/^body > /);
    expect(r.selector.split('>').length).toBeLessThanOrEqual(3);
  });

  it('nth-of-type 只在同 tag 兄弟不唯一时出现', () => {
    setHtml('<div class="a"><span></span></div>');
    const target = document.querySelector('span')!;
    const r = expectRoundTrip(target);
    // 只有一个 span，不需要 :nth-of-type
    expect(r.selector.includes(':nth-of-type')).toBe(false);
  });

  it('同 tag 多兄弟时带上正确的 nth-of-type 序号', () => {
    setHtml(`
      <div class="toolbar">
        <button>一</button>
        <button>二</button>
        <button>三</button>
      </div>`);
    const third = document.querySelectorAll('button')[2]!;
    const r = expectRoundTrip(third);
    expect(r.selector).toContain('nth-of-type(3)');
  });

  it('遇到稳定 id 祖先时以它为锚点停止上爬', () => {
    setHtml(`
      <div id="dvContainer">
        <div class="inner"><span class="dot"></span></div>
      </div>`);
    const target = document.querySelector('.dot')!;
    const r = expectRoundTrip(target);
    expect(r.selector).not.toMatch(/^body/);
  });
});

describe('T2/T3/T4 降级', () => {
  it('有稳定 id 时优先于 class', () => {
    setHtml('<div id="frame-main-cont-head" class="many other"></div>');
    const target = document.querySelector('#frame-main-cont-head')!;
    const r = expectRoundTrip(target);
    // 可能落 T2(id)，也可能 T1(结构路径以 id 为锚) —— 两者都合法，但不能是 class 层
    expect(['id', 'path']).toContain(r.tier);
    expect(r.selector).toContain('frame-main-cont-head');
  });

  it('动态 id 被跳过，改走 class', () => {
    setHtml('<div id="_mail_button_212_1083" class="js-component-button nui-btn"></div>');
    const target = document.querySelector('.js-component-button')!;
    const r = expectRoundTrip(target);
    expect(r.selector).not.toContain('_mail_button');
  });

  it('class 唯一时 selector 里带上该 class（不写成一条长链）', () => {
    setHtml('<div class="unique-thing"></div>');
    const r = expectRoundTrip(document.querySelector('.unique-thing')!);
    // 单个元素时结构路径与 class 层会得到同一个 `div.unique-thing`，
    // tier 标成 path 还是 class 都合理 —— 断言"结果够短且带 class"而不是具体 tier
    expect(r.selector).toContain('.unique-thing');
    expect(r.selector.split('>').length).toBe(1);
  });

  it('class 不唯一时靠 :nth-of-type 或组合 class 区分', () => {
    setHtml(`
      <div class="a b"></div>
      <div class="a c"></div>`);
    const first = document.querySelector('.a.b')!;
    const r = expectRoundTrip(first);
    // 唯一性由 expectRoundTrip 保证；这里只确认它没有退化成超长路径
    expect(r.selector.split('>').length).toBeLessThanOrEqual(2);
  });

  it('没有任何可用抓手时仍能产出唯一 selector（T4 或 fallback）', () => {
    setHtml(`
      <div><div><div></div></div><div><div><div></div></div></div></div>`);
    const deep = document.querySelectorAll('div')[5]!;
    const r = expectRoundTrip(deep);
    expect(['combined', 'path', 'fallback']).toContain(r.tier);
  });
});

describe('边界情况', () => {
  it('html/body 不作为目标（调用方会过滤，这里只验证不会崩溃）', () => {
    setHtml('<div></div>');
    const r = generateSelector(document.body);
    expect(typeof r.selector).toBe('string');
  });

  it('Shadow DOM 内的元素被标记 shadow 并提示不支持', () => {
    setHtml('<div id="host"></div>');
    const host = document.querySelector('#host')!;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<span></span>';
    const inner = root.querySelector('span')!;
    expect(isInShadowDom(inner)).toBe(true);
    const r = generateSelector(inner, { allowShadow: false });
    expect(r.shadow).toBe(true);
    expect(r.selector).toBe('');
  });

  it('Shadow DOM 外的元素 shadow === false', () => {
    setHtml('<div aria-label="刷新"></div>');
    expect(generateSelector(document.querySelector('div')!).shadow).toBe(false);
  });

  it('同一元素反复生成，结果稳定（幂等）', () => {
    setHtml(
      '<div class="wrap"><div class="row"><button aria-label="刷新"></button></div></div>',
    );
    const target = document.querySelector('[aria-label="刷新"]')!;
    const a = generateSelector(target);
    const b = generateSelector(target);
    expect(a.selector).toBe(b.selector);
    expect(a.tier).toBe(b.tier);
  });

  it('selector 语法非法时 isUniqueFor 返回 false 而不是抛错', () => {
    setHtml('<div></div>');
    expect(isUniqueFor('###', document.querySelector('div')!)).toBe(false);
  });
});
