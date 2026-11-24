/**
 * 输入框的严格整数解析（OQ-5：只要整数，不要小数）。
 *
 * 不能用 `Number.parseInt`：它会把 "2.5" 悄悄截成 2、"12abc" 截成 12，
 * 用户看到的是"输入被接受但值变了"。这里一律拒绝含小数/非数字的输入。
 */
export function parseStrictInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** 解析 + 夹到 [min, max]；非法输入返回 null，由调用方回滚显示值 */
export function parseIntInRange(raw: string, min: number, max: number): number | null {
  const parsed = parseStrictInt(raw);
  if (parsed === null) return null;
  return Math.min(max, Math.max(min, parsed));
}
