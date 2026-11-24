/**
 * 选择器生成器。设计依据 docs/10 §1.6 / ADR-019
 *
 * 目标：给定一个元素，产出一个**合法、唯一、尽量简短且稳定**的 CSS selector。
 *
 * 5 层降级（每层都必须实测"唯一命中该元素"，否则降到下一层）：
 *   T0 语义属性   [aria-label="刷新"]                      ← 用户确认排在结构之前
 *   T1 结构路径   body > div.xxx:nth-of-type(2) > … > target（含最小化）
 *   T2 id        #dvContainer
 *   T3 class     .js-component-button.nui-btn
 *   T4 兜底      tag.class[role]:nth-of-type(n)（必要时带父级）
 *
 * 稳定性启发式只负责"降低踩坑概率"，最终以实测唯一性为准 —— 从不假装聪明。
 */

/** 生成结果 */
export type SelectorResult = {
  /** 命中的层级；`fallback` 表示五层都没能唯一命中，用了完整绝对路径 */
  tier: 'semantic' | 'path' | 'id' | 'class' | 'combined' | 'fallback';
  selector: string;
  /** 反查是否唯一命中该元素（几乎总是 true，fallback 之外） */
  unique: boolean;
  /** 是否需要提示"selector 较长，页面结构变化后可能失效" */
  long: boolean;
  /** 该元素在 Shadow DOM 内时为 true（document.querySelector 穿不透，需提示） */
  shadow: boolean;
};

/** 语义属性（T0）——只取这些：它们由作者显式书写，比结构路径稳 */
const SEMANTIC_ATTRS = ['aria-label', 'data-tooltip', 'title', 'name', 'alt', 'placeholder'] as const;

/** 3 位以上连续数字 —— 动态 id / 时间戳 / 自增计数（`_mail_button_228_1148`） */
const NUMERIC_RUN = /\d{3,}/;
/** 哈希后缀（`Button-root-1a2b3c`、`Card__abc123`） */
const HASHY_TAIL = /[-_]([a-z0-9]{6,})$/i;
/** 构建产物前缀（`css-1a2b`、`sc-bdVaJa`、`emotion-`、`v-`、`data-v-`） */
const FRAMEWORK_PREFIX = /^(css|sc|emotion|jsx|bx|v|data-v|svelte|astro)[-_]/i;
/** 需要转义/容易出错的字符 */
const NEEDS_ESCAPE = /[[\]:.#\s'"\\]/;
/** 状态类后缀（会随交互变化） */
const STATE_WORD =
  /(^|[-_])(active|current|selected|hover|hovered|focus|focused|loading|disabled|hidden|visible|open|opened|expanded|collapsed|checked|pressed|dragging|dragover|error|success|warning)([-_]|$)/i;

const MAX_NAME_LEN = 40;
const MAX_ATTR_VALUE_LEN = 60;

/** id / class 是否可用作稳定抓手 */
export function isStableName(name: string): boolean {
  if (!name || name.length > MAX_NAME_LEN) return false;
  if (NUMERIC_RUN.test(name)) return false;
  if (FRAMEWORK_PREFIX.test(name)) return false;
  if (STATE_WORD.test(name)) return false;
  if (NEEDS_ESCAPE.test(name)) return false;
  // 纯数字或纯短哈希形式的类名
  if (/^[a-z0-9]{1,2}$/i.test(name)) return false;
  // 只对 id 检查哈希尾巴（`card__abc123` 这种类名在实际项目里也常见）
  if (HASHY_TAIL.test(name) && /\d/.test(name)) return false;
  return true;
}

/** 该元素是否在 Shadow DOM 里（document.querySelector 穿不过 shadow 边界） */
export function isInShadowDom(el: Element): boolean {
  const root = el.getRootNode();
  return root !== document && root.nodeType === Node.DOCUMENT_FRAGMENT_NODE;
}

function tryQuery(sel: string): Element[] | null {
  try {
    return [...document.querySelectorAll(sel)];
  } catch {
    return null; // 语法非法
  }
}

/** 唯一命中判定：长度 1 且就是它 */
export function isUniqueFor(selector: string, el: Element): boolean {
  const nodes = tryQuery(selector);
  return nodes !== null && nodes.length === 1 && nodes[0] === el;
}

function escapeAttrValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function tagOf(el: Element): string {
  return el.tagName.toLowerCase();
}

function nthOfTypeIndex(el: Element): number {
  let i = 1;
  for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
    if (p.tagName === el.tagName) i += 1;
  }
  return i;
}

function sameTagSiblingCount(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 1;
  let n = 0;
  for (const c of parent.children) if (c.tagName === el.tagName) n += 1;
  return n;
}

function stableIdOf(el: Element): string | null {
  const id = el.id;
  return id && isStableName(id) ? id : null;
}

function stableClassesOf(el: Element): string[] {
  return [...el.classList].filter(isStableName);
}

// ── T0 语义属性 ────────────────────────────────────────────────
function buildSemantic(el: Element): string | null {
  for (const attr of SEMANTIC_ATTRS) {
    const raw = el.getAttribute(attr);
    if (!raw) continue;
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value || value.length > MAX_ATTR_VALUE_LEN) continue;

    const bare = `[${attr}="${escapeAttrValue(value)}"]`;
    if (isUniqueFor(bare, el)) return bare;
    const withTag = `${tagOf(el)}${bare}`;
    if (isUniqueFor(withTag, el)) return withTag;
  }
  return null;
}

// ── T1 结构路径 ────────────────────────────────────────────────
/**
 * 单层结构片段（不含父级）。
 *
 * 优先"tag + 稳定 class"而不是纯 nth-of-type —— 实测更短也更稳：
 * `div.layout-indexs-child:nth-of-type(4)` 比 `div:nth-of-type(12)` 强得多。
 * 只有当同 tag 兄弟唯一时才省略 :nth-of-type（否则必然不唯一）。
 */
function buildSegment(el: Element, forceIndex: boolean): string {
  const id = stableIdOf(el);
  if (id) return `#${escapeLiteral(id)}`;

  const cls = stableClassesOf(el)[0];
  const tag = tagOf(el);
  const base = cls ? `${tag}.${escapeLiteral(cls)}` : tag;
  if (!forceIndex && !cls && sameTagSiblingCount(el) === 1) return base;
  return `${base}:nth-of-type(${nthOfTypeIndex(el)})`;
}

/** CSS 标识符里的特殊字符转义（只处理我们允许通过的那些） */
function escapeLiteral(name: string): string {
  const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape : null;
  return esc ? esc(name) : name.replace(/([^\w-])/g, '\\$1');
}

/** 构造从 body 到目标的绝对路径（不做最小化） */
function buildAbsolutePath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;

  while (cur && cur !== document.body && cur !== document.documentElement) {
    const seg = buildSegment(cur, true);
    parts.unshift(seg);
    // 遇到稳定 id 祖先：以它为锚，停止继续上爬（路径会短很多）
    if (seg.startsWith('#')) break;
    cur = cur.parentElement;
  }

  if (parts.length === 0 || !parts[0]!.startsWith('#')) parts.unshift('body');
  return parts.join(' > ');
}

/**
 * 贪心最小化，两步：
 *
 * 1. **删段**：从头开始逐段试着删，删掉后仍唯一就真的删并从头再来。
 *    「从头再来」是必要的：删掉中间某段后，后面原本删不掉的段可能变得可删。
 *    实测能把 `body > div:nth-of-type(2) > …` 这种前缀整段删掉。
 * 2. **削后缀**：每段里的 `:nth-of-type(n)` 在不需要时去掉
 *    （`span:nth-of-type(1)` → `span`）。只删段是不够的 ——
 *    段在手、后缀是同级兄弟唯一性带来的，单独削掉往往仍然唯一，结果更短。
 */
function minimize(parts: string[], el: Element): string[] {
  let out = [...parts];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length - 1; i += 1) {
      const trial = out.filter((_, k) => k !== i);
      const sel = trial.join(' > ');
      if (isUniqueFor(sel, el)) {
        out = trial;
        changed = true;
        break;
      }
    }
  }

  // 第二步：削掉 :nth-of-type(n)
  const stripped: string[] = [];
  for (const seg of out) {
    const without = seg.replace(/:nth-of-type\(\d+\)$/, '');
    if (!without || without === seg) {
      stripped.push(seg);
      continue;
    }
    const candidate = [...stripped, without, ...out.slice(stripped.length + 1)].join(' > ');
    if (isUniqueFor(candidate, el)) stripped.push(without);
    else stripped.push(seg);
  }

  return stripped;
}

function buildPath(el: Element): string | null {
  const absolute = buildAbsolutePath(el);
  if (!isUniqueFor(absolute, el)) return null;
  const minimized = minimize(absolute.split(' > '), el);
  const sel = minimized.join(' > ');
  return isUniqueFor(sel, el) ? sel : absolute;
}

// ── T2 id ─────────────────────────────────────────────────────
function buildById(el: Element): string | null {
  const id = stableIdOf(el);
  if (!id) return null;
  const sel = `#${escapeLiteral(id)}`;
  return isUniqueFor(sel, el) ? sel : null;
}

// ── T3 class ──────────────────────────────────────────────────
function buildByClass(el: Element): string | null {
  const classes = stableClassesOf(el).slice(0, 2);
  if (classes.length === 0) return null;

  const tag = tagOf(el);
  const candidates: string[] = [];
  for (const c of classes) {
    candidates.push(`${tag}.${escapeLiteral(c)}`);
    candidates.push(`.${escapeLiteral(c)}`);
  }
  if (classes.length === 2) {
    candidates.push(`${tag}.${escapeLiteral(classes[0]!)}.${escapeLiteral(classes[1]!)}`);
    candidates.push(`.${escapeLiteral(classes[0]!)}.${escapeLiteral(classes[1]!)}`);
  }

  for (const sel of candidates) if (isUniqueFor(sel, el)) return sel;
  return null;
}

// ── T4 兜底组合 ────────────────────────────────────────────────
function buildCombined(el: Element): string | null {
  const tag = tagOf(el);
  const cls = stableClassesOf(el)[0];
  const attrs: string[] = [];
  for (const name of ['role', 'type', 'aria-expanded', 'href'] as const) {
    const v = el.getAttribute(name);
    if (!v || v.length >= MAX_ATTR_VALUE_LEN) continue;
    // href 只留 pathname，避免 query/参数漂移
    if (name === 'href') {
      if (v.startsWith('#') || v.startsWith('javascript:')) continue;
      try {
        attrs.push(`[href="${escapeAttrValue(new URL(v, location.origin).pathname)}"]`);
      } catch {
        /* 相对 URL 解析失败就跳过 */
      }
      continue;
    }
    if (name === 'aria-expanded' && v !== 'true' && v !== 'false') continue;
    attrs.push(`[${name}="${escapeAttrValue(v)}"]`);
  }

  const base = `${tag}${cls ? `.${escapeLiteral(cls)}` : ''}${attrs.join('')}:nth-of-type(${nthOfTypeIndex(el)})`;
  if (isUniqueFor(base, el)) return base;

  const parent = el.parentElement;
  if (parent) {
    const parentSeg = buildSegment(parent, true);
    const withParent = `${parentSeg} > ${base}`;
    if (isUniqueFor(withParent, el)) return withParent;
  }
  return null;
}

/** 结构路径"够短"的上限：超过就认为不如 id/class 实用（用户要的"优先结构"不该变成一条长链） */
const MAX_PATH_SEGMENTS = 3;
const MAX_PATH_LENGTH = 60;

/**
 * 生成选择器。
 *
 * 层级顺序（ADR-019，用户已确认语义属性排第一）：
 *   1. semantic  语义属性
 *   2. path      结构路径 —— **仅当最小化后足够短**（≤3 段且 ≤60 字符）
 *   3. id        稳定 id
 *   4. class     稳定 class（最多两个组合）
 *   5. combined  tag + class + 属性 + nth-of-type 兜底
 *   6. path(长)  以上都没唯一命中时，退回完整绝对路径（构造上必然唯一）
 *
 * 为什么 path 要有"够短"这个门槛：纯按顺序的话结构路径几乎总能唯一命中，
 * id / class 两层就永远不会被用到 —— 用户要的"优先结构"本意是**优先不依赖
 * 元素自身标识的结构**，而不是"宁可写一条 6 段的长链也不用 id"。
 * 实测那个 `<h1>` 就正好落在这个边界上：长路径是唯一解，此时如实回落并标注 long。
 */
export function generateSelector(el: Element, opts: { allowShadow?: boolean } = {}): SelectorResult {
  const shadow = isInShadowDom(el);
  const allowShadow = opts.allowShadow ?? true;

  const base = { shadow, long: false, unique: false };

  if (shadow && !allowShadow) {
    return { ...base, tier: 'fallback', selector: '' };
  }

  // 目标不能在 document 里被 querySelector 找到（说明在 shadow 里）→ 直接回落
  if (shadow) {
    const path = buildAbsolutePath(el);
    return { ...base, tier: 'fallback', selector: path, long: true, unique: false };
  }

  // 1. 语义属性
  const semantic = buildSemantic(el);
  if (semantic) return { ...base, tier: 'semantic', selector: semantic, unique: true };

  // 2. 结构路径（够短才用）
  const path = buildPath(el);
  if (path) {
    const segments = path.split('>').length;
    if (segments <= MAX_PATH_SEGMENTS && path.length <= MAX_PATH_LENGTH) {
      return { ...base, tier: 'path', selector: path, unique: true };
    }
  }

  // 3. id
  const byId = buildById(el);
  if (byId) return { ...base, tier: 'id', selector: byId, unique: true };

  // 4. class
  const byClass = buildByClass(el);
  if (byClass) return { ...base, tier: 'class', selector: byClass, unique: true };

  // 5. 兜底组合
  const combined = buildCombined(el);
  if (combined) return { ...base, tier: 'combined', selector: combined, unique: true };

  // 6. 只能是长路径了
  const longPath = path ?? buildAbsolutePath(el);
  return {
    ...base,
    tier: 'fallback',
    selector: longPath,
    unique: isUniqueFor(longPath, el),
    long: true,
  };
}
