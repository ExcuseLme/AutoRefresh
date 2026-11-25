// @vitest-environment happy-dom
/**
 * 输入框占用判定的「展示型输入框」回归测试（ADR-033）
 *
 * 真实 bug：用户在 Bitbucket 的 PR 页面上，焦点不在任何输入框、也没有填任何内容，
 * 倒计时却一直暂停。
 *
 * 根因：该页面有一个 `readonly` 的 `<input class="clone-url-input">`，
 * `value` 永远是 clone 地址。原实现只排除了 `disabled` 没排除 `readOnly`，
 * 于是"有内容"判定恒为真 ⇒ 永久暂停。
 *
 * 判据不是"有没有值"，而是**"用户能不能把它清掉"**。
 */
import { describe, expect, it } from 'vitest';
import { computeInputHold } from '@/lib/input-hold';

describe('readOnly / disabled 输入框不得触发暂停（ADR-033）', () => {
  it('readOnly 输入框有值也不算占用（Bitbucket clone-url 场景）', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.value = 'http://git.prd.fun/git/scm/scf/bmw-service.git';
    document.body.appendChild(input);
    input.blur();

    expect(computeInputHold(document)).toBe(false);
    input.remove();
  });

  it('readOnly textarea 有值也不算占用', () => {
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.value = 'frozen text';
    document.body.appendChild(ta);

    expect(computeInputHold(document)).toBe(false);
    ta.remove();
  });

  it('readOnly 输入框拿到焦点也不算占用（用户无法编辑它）', () => {
    const input = document.createElement('input');
    input.readOnly = true;
    input.value = 'x';
    document.body.appendChild(input);
    input.focus();

    expect(computeInputHold(document)).toBe(false);
    input.remove();
  });

  it('普通可编辑输入框有值仍然算占用（不要把修复做过头）', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'user typed this';
    document.body.appendChild(input);

    expect(computeInputHold(document)).toBe(true);
    input.remove();
  });

  it('可编辑输入框空值 + 无焦点 ⇒ 不占用', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = '';
    document.body.appendChild(input);

    expect(computeInputHold(document)).toBe(false);
    input.remove();
  });

  it('混合场景：一个 readOnly 展示框 + 一个空的可编辑框 ⇒ 不占用', () => {
    const ro = document.createElement('input');
    ro.readOnly = true;
    ro.value = 'clone url';

    const editable = document.createElement('input');
    editable.type = 'text';
    editable.value = '';

    document.body.append(ro, editable);
    expect(computeInputHold(document)).toBe(false);
    ro.remove();
    editable.remove();
  });
});
