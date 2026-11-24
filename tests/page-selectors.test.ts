import { describe, expect, it } from 'vitest';
import {
  MAX_PAGES,
  MAX_SELECTOR_LEN,
  enforceCapacity,
  getPageEntry,
  pageKeyOf,
  sanitizePageSelectors,
  setPageEntry,
  type PageSelectorMap,
} from '@/lib/page-selectors';

describe('pageKeyOf（ADR-022：协议 + 主机 + 路径，忽略 query / hash）', () => {
  it('忽略 query', () => {
    expect(pageKeyOf('https://mail.163.com/js6/main.jsp?sid=AAA')).toBe(
      'https://mail.163.com/js6/main.jsp',
    );
    expect(pageKeyOf('https://example.com/a?x=1&y=2')).toBe('https://example.com/a');
  });

  it('忽略 hash（Gmail 切文件夹共用一份配置）', () => {
    expect(pageKeyOf('https://mail.google.com/mail/u/0/#inbox')).toBe('https://mail.google.com/mail/u/0');
    expect(pageKeyOf('https://mail.google.com/mail/u/0/#inbox')).toBe(
      pageKeyOf('https://mail.google.com/mail/u/0/#sent'),
    );
  });

  it('不是域名级：不同路径是不同页面', () => {
    expect(pageKeyOf('https://mail.google.com/mail/u/0/')).not.toBe(
      pageKeyOf('https://mail.google.com/mail/u/1/'),
    );
  });

  it('尾部斜杠归一（/a 与 /a/ 是同一页面）', () => {
    expect(pageKeyOf('https://example.com/a/')).toBe(pageKeyOf('https://example.com/a'));
    expect(pageKeyOf('https://example.com/')).toBe('https://example.com/');
  });

  it('主机名大小写归一', () => {
    expect(pageKeyOf('https://EXAMPLE.com/a')).toBe('https://example.com/a');
  });

  it('保留默认端口语义（URL 规范化会去掉默认端口）', () => {
    expect(pageKeyOf('https://example.com:443/a')).toBe('https://example.com/a');
    expect(pageKeyOf('http://example.com:8080/a')).toBe('http://example.com:8080/a');
  });

  it('http 与 https 是不同 key（协议参与隔离）', () => {
    expect(pageKeyOf('http://example.com/a')).not.toBe(pageKeyOf('https://example.com/a'));
  });

  it('非 http(s) / 无法解析 → null（绝不回落到别的页面）', () => {
    expect(pageKeyOf('chrome://extensions/')).toBeNull();
    expect(pageKeyOf('file:///C:/x.html')).toBeNull();
    expect(pageKeyOf('about:blank')).toBeNull();
    expect(pageKeyOf('')).toBeNull();
    expect(pageKeyOf(undefined)).toBeNull();
    expect(pageKeyOf('not a url')).toBeNull();
  });
});

describe('getPageEntry / setPageEntry', () => {
  it('没配过就是 null，不会回落到别的页面', () => {
    const map = setPageEntry({}, 'https://a.com/x', '[aria-label="刷新"]', 'single');
    expect(getPageEntry(map, 'https://a.com/y')).toBeNull();
    expect(getPageEntry(map, 'https://a.com/x')?.selector).toBe('[aria-label="刷新"]');
  });

  it('写 B 页面不会影响 A 页面（这就是用户报的 bug）', () => {
    let map: PageSelectorMap = {};
    map = setPageEntry(map, 'https://a.com/x', '.btnA', 'single');
    map = setPageEntry(map, 'https://b.com/x', '.btnB', 'double');
    expect(getPageEntry(map, 'https://a.com/x')).toEqual(
      expect.objectContaining({ selector: '.btnA', action: 'single' }),
    );
    expect(getPageEntry(map, 'https://b.com/x')).toEqual(
      expect.objectContaining({ selector: '.btnB', action: 'double' }),
    );
  });

  it('query 不同的同一路径共享配置（网易 sid 会变）', () => {
    let map = setPageEntry({}, 'https://mail.163.com/js6/main.jsp?sid=AAA', '.refresh', 'single');
    expect(getPageEntry(map, 'https://mail.163.com/js6/main.jsp?sid=BBB')?.selector).toBe('.refresh');
  });

  it('action 跟着 selector 一起按页面存', () => {
    const map = setPageEntry({}, 'https://a.com/x', '.btn', 'double');
    expect(getPageEntry(map, 'https://a.com/x')?.action).toBe('double');
  });

  it('同一页面再写一次是覆盖（不新增条目）', () => {
    let map = setPageEntry({}, 'https://a.com/x', '.old', 'single');
    map = setPageEntry(map, 'https://a.com/x', '.new', 'double');
    expect(Object.keys(map)).toHaveLength(1);
    expect(getPageEntry(map, 'https://a.com/x')?.selector).toBe('.new');
  });

  it('传空 selector = 删除该页记录（不留空壳）', () => {
    let map = setPageEntry({}, 'https://a.com/x', '.btn', 'single');
    map = setPageEntry(map, 'https://a.com/x', '   ', 'single');
    expect(Object.keys(map)).toHaveLength(0);
    expect(getPageEntry(map, 'https://a.com/x')).toBeNull();
  });

  it('selector 前后空白被 trim', () => {
    const map = setPageEntry({}, 'https://a.com/x', '  .btn  ', 'single');
    expect(getPageEntry(map, 'https://a.com/x')?.selector).toBe('.btn');
  });

  it('超长 selector 被截断到上限', () => {
    const map = setPageEntry({}, 'https://a.com/x', 'a'.repeat(MAX_SELECTOR_LEN + 100), 'single');
    expect(getPageEntry(map, 'https://a.com/x')?.selector.length).toBe(MAX_SELECTOR_LEN);
  });

  it('无法解析 URL 时写入被忽略（不产生 key）', () => {
    const map = setPageEntry({}, 'chrome://settings/', '.btn', 'single');
    expect(Object.keys(map)).toHaveLength(0);
  });

  it('不修改入参（返回新对象）', () => {
    const original: PageSelectorMap = {};
    const next = setPageEntry(original, 'https://a.com/x', '.btn', 'single');
    expect(original).toEqual({});
    expect(next).not.toBe(original);
  });
});

describe('enforceCapacity（LRU 淘汰，防脏数据撑爆 storage）', () => {
  it('未超限时原样返回', () => {
    const map = setPageEntry({}, 'https://a.com/x', '.btn', 'single');
    expect(enforceCapacity(map, 10)).toEqual(map);
  });

  it('超限时淘汰 updatedAt 最旧的', () => {
    const map: PageSelectorMap = {
      'https://a.com/1': { selector: '.a', action: 'single', updatedAt: 100 },
      'https://a.com/2': { selector: '.b', action: 'single', updatedAt: 200 },
      'https://a.com/3': { selector: '.c', action: 'single', updatedAt: 300 },
    };
    const trimmed = enforceCapacity(map, 2);
    expect(Object.keys(trimmed).sort()).toEqual(['https://a.com/2', 'https://a.com/3']);
  });

  it('默认上限是 MAX_PAGES', () => {
    const map: PageSelectorMap = {};
    for (let i = 0; i < MAX_PAGES + 5; i += 1) {
      map[`https://a.com/p${i}`] = { selector: '.x', action: 'single', updatedAt: i };
    }
    const trimmed = enforceCapacity(map);
    expect(Object.keys(trimmed)).toHaveLength(MAX_PAGES);
    // 淘汰的是最旧的 5 个
    expect(trimmed['https://a.com/p0']).toBeUndefined();
    expect(trimmed[`https://a.com/p${MAX_PAGES + 4}`]).toBeDefined();
  });
});

describe('sanitizePageSelectors（逐条校验脏数据）', () => {
  it('非对象输入 → 空 map', () => {
    expect(sanitizePageSelectors(null)).toEqual({});
    expect(sanitizePageSelectors('garbage')).toEqual({});
    expect(sanitizePageSelectors([])).toEqual({});
  });

  it('丢弃非法 key 与空 selector，保留好的条目', () => {
    const out = sanitizePageSelectors({
      'https://a.com/x': { selector: '.ok', action: 'single', updatedAt: 1 },
      'not-a-key': { selector: '.bad', action: 'single', updatedAt: 2 },
      'https://a.com/y': { selector: '', action: 'single', updatedAt: 3 },
      'https://a.com/z': 'i am not an object',
    });
    expect(Object.keys(out)).toEqual(['https://a.com/x']);
    expect(out['https://a.com/x']?.selector).toBe('.ok');
  });

  it('action 脏值回落 single', () => {
    const out = sanitizePageSelectors({
      'https://a.com/x': { selector: '.ok', action: 'triple', updatedAt: 1 },
    });
    expect(out['https://a.com/x']?.action).toBe('single');
  });

  it('updatedAt 脏值回落 0', () => {
    const out = sanitizePageSelectors({
      'https://a.com/x': { selector: '.ok', action: 'single', updatedAt: 'nope' },
    });
    expect(out['https://a.com/x']?.updatedAt).toBe(0);
  });

  it('清洗后也做容量收敛', () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < MAX_PAGES + 3; i += 1) {
      raw[`https://a.com/p${i}`] = { selector: '.x', action: 'single', updatedAt: i };
    }
    expect(Object.keys(sanitizePageSelectors(raw))).toHaveLength(MAX_PAGES);
  });
});
