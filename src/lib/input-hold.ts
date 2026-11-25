/**
 * 「输入框占用」判定（ADR-032）
 *
 * 用户需求（原话）：
 *   "光标在输入框内或输入框内有任何内容时持续打断刷新，
 *    直到光标不在任何输入框内且所有输入框内没有内容时才恢复自动倒计时刷新"
 *
 * 所以判定是**状态**而非事件：任一条件成立即"占用中"。
 *
 * 为什么不能只看事件（click / keydown）：
 *   1. 光标可能通过 Tab / 程序化 focus 进入输入框，没有点击事件；
 *   2. 输入框内容可能通过粘贴、脚本赋值、自动填充变化，没有键盘事件；
 *   3. 光标移出（blur）本身也可能是程序触发的。
 * 因此需要"事件触发重算 + 兜底轮询"两条腿（见 content script 的输入框监视器）。
 *
 * 这里的纯函数只在**主文档**上判定：内容脚本是 `allFrames: false`，
 * 子 iframe 里的输入框看不到，也不该假装看到。
 */

/** 会被当成"有内容即有占用"的 input 类型。button/checkbox/radio 之类没有文本内容 */
const TEXT_LIKE_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  '',
]);

function inputTypeOf(el: HTMLInputElement): string {
  return (el.getAttribute('type') ?? '').toLowerCase();
}

/** 任何 input / textarea 都算"光标在输入类控件内"（含 checkbox 等，因为焦点确实在里面） */
function isEditableFocus(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * 元素是否"有内容"。
 *
 * 覆盖三类：
 *   - 文本类 `input`（text/search/email/url/tel/password/number，含默认 type）→ `value`
 *   - `textarea` → `value`
 *   - `contenteditable` → `textContent`
 *
 * **`readOnly` 必须视为"没有内容"**（ADR-033）。这是 Bitbucket / GitLab 这类页面的实际坑：
 * 它们用一个 `readonly` 的 `<input class="clone-url-input">` 展示 clone 地址，
 * 用户既不能清空也不能编辑它 —— 但它的 `value` 又永远是满的。
 * 如果把它算作"有内容"，倒计时会**永久暂停**，用户看到的就是"焦点不在输入框、也没有任何
 * 我填的内容，却一直暂停"。
 *
 * 判据不是"有没有值"，而是**"用户能不能把它清掉"**：
 *   readOnly / disabled 的输入框用户清不掉 ⇒ 不该由它触发暂停。
 *
 * checkbox / radio / file / range 同理不算（它们的"内容"不是文本）。
 */
function hasContent(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) {
    return el.disabled || el.readOnly ? false : el.value.trim().length > 0;
  }
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false;
    return TEXT_LIKE_INPUT_TYPES.has(inputTypeOf(el)) ? el.value.trim().length > 0 : false;
  }
  if ((el as HTMLElement).isContentEditable) {
    return (el.textContent ?? '').trim().length > 0;
  }
  return false;
}

/** 一次扫描的节点上限：超大表单页面也不至于卡住内容脚本 */
const MAX_SCAN = 5000;

/**
 * 当前文档是否"输入框占用中"。
 *
 * 成立条件（任一）：
 *   - `document.activeElement` 是**可编辑**的输入类控件（非 disabled / readOnly）
 *   - 任意**可编辑**文本类输入框 / textarea / contenteditable 区块有非空白内容
 *
 * 关键：`readOnly` / `disabled` 的输入框两边都排除。它们是"展示用"的
 * （典型：Bitbucket 的 clone URL 输入框），用户既不能编辑也不能清空，
 * 算进来会让倒计时永久暂停（ADR-033）。
 */
export function computeInputHold(doc: Document): boolean {
  if (isEditableFocus(doc.activeElement)) return true;

  let seen = 0;
  for (const el of doc.querySelectorAll('input, textarea, [contenteditable]')) {
    if (++seen > MAX_SCAN) break;
    // [contenteditable="false"] 不是可编辑区，跳过
    if (
      el instanceof HTMLElement &&
      el.isContentEditable === false &&
      el.hasAttribute('contenteditable')
    ) {
      continue;
    }
    if (hasContent(el)) return true;
  }
  return false;
}
