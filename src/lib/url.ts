import type { Options } from './options';

/** 是否是可自动刷新的页面。对齐 err_page_unavailable 的文案：仅 http/https */
export function isRefreshableUrl(url: string | undefined): url is string {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/** 去掉协议与 www，用于比较「是否同一地址」（对齐 ARP `nx()`） */
export function normalizeUrl(url: string): string {
  let t = url.replace(/(^\w+:|^)\/\//, '');
  t = t.replace(/^www\./, '');
  if (!t.endsWith('/')) t += '/';
  return t;
}

export function sameUrl(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeUrl(a) === normalizeUrl(b);
}

/**
 * 本轮完整刷新该回到哪个 URL（docs/05 §4）。
 * - follow：返回 null ⇒ 刷新"当下这个 URL"（页面自己的重定向会自然生效）
 * - canonical：返回 canonicalUrl ⇒ 若与当前不同，先 tabs.update 回去
 */
export function pickTargetUrl(opts: Pick<Options, 'redirection'>, canonicalUrl: string): string | null {
  return opts.redirection === 'canonical' ? canonicalUrl : null;
}

/** 达到刷新次数上限？（ADR-010：用 >= 而不是 ARP 的 >） */
export function reachedLimit(opts: Pick<Options, 'refreshLimitEnabled' | 'refreshLimitCount'>, count: number): boolean {
  return opts.refreshLimitEnabled && opts.refreshLimitCount >= 1 && count >= opts.refreshLimitCount;
}
