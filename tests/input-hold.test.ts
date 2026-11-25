// @vitest-environment happy-dom
/**
 * 「输入框占用」判定测试（ADR-032）
 *
 * 用户的需求是**状态**判定：
 *   "光标在输入框内或输入框内有任何内容时持续打断刷新，
 *    直到光标不在任何输入框内且所有输入框内没有内容时才恢复"
 *
 * 所以这里测的是 `computeInputHold(doc)` 在各种 DOM 状态下的返回值。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { computeInputHold } from '@/lib/input-hold';

function focus(el: HTMLElement): void {
  el.focus();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('computeInputHold（ADR-032）', () => {
  it('空页面 ⇒ 不占用', () => {
    expect(computeInputHold(document)).toBe(false);
  });

  it('光标在 input 内（无内容）⇒ 占用', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    focus(input);
    expect(computeInputHold(document)).toBe(true);
  });

  it('光标不在 input 但 input 有内容 ⇒ 占用', () => {
    const input = document.createElement('input');
    input.value = 'hello';
    document.body.appendChild(input);
    expect(computeInputHold(document)).toBe(true);
  });

  it('空白内容不算占用（trim 后为空）', () => {
    const input = document.createElement('input');
    input.value = '   ';
    document.body.appendChild(input);
    expect(computeInputHold(document)).toBe(false);
  });

  it('光标移出且内容清空 ⇒ 解除占用', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    focus(input);
    expect(computeInputHold(document)).toBe(true);

    input.blur();
    input.value = '';
    expect(computeInputHold(document)).toBe(false);
  });

  it('textarea 同样适用', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    focus(ta);
    expect(computeInputHold(document)).toBe(true);

    ta.blur();
    ta.value = 'draft';
    expect(computeInputHold(document)).toBe(true); // 有内容仍占用
  });

  it('contenteditable 有内容 ⇒ 占用', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.textContent = 'some text';
    document.body.appendChild(div);
    expect(computeInputHold(document)).toBe(true);
  });

  it('contenteditable 为空且无焦点 ⇒ 不占用', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    expect(computeInputHold(document)).toBe(false);
  });

  it('checkbox 的"内容"不算占用（它的 value 不是用户可清空的文本）', () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = 'on';
    document.body.appendChild(cb);
    // checkbox 默认 value='on'，但用户无法"清空"它 ⇒ 不应让倒计时永远暂停
    expect(computeInputHold(document)).toBe(false);
  });

  it('disabled 输入框既不算焦点占用也不算有内容', () => {
    const input = document.createElement('input');
    input.disabled = true;
    input.value = 'frozen';
    document.body.appendChild(input);
    expect(computeInputHold(document)).toBe(false);
  });

  it('readOnly 输入框不接收焦点 ⇒ 不算焦点占用', () => {
    const input = document.createElement('input');
    input.readOnly = true;
    document.body.appendChild(input);
    focus(input);
    // happy-dom 里 readOnly 仍可能拿到焦点，但我们的判定把它排除
    expect(computeInputHold(document)).toBe(false);
  });
});
