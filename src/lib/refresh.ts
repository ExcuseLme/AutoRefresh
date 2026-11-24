import type { ClickAction } from './options';
import type { ContentCommand, RefreshFailureCode } from './messages';

export type RefreshOutcome = { ok: true } | { ok: false; reason: RefreshFailureCode };

/**
 * 内容脚本按需注入（ADR-014）。
 *
 * 场景：扩展安装/更新之前就已经打开的标签页，浏览器不会补注入 content script，
 * 于是 `tabs.sendMessage` 直接抛 "Could not establish connection"。
 * 这里用 `chrome.scripting.executeScript` 手动注入兜底，避免用户必须先刷新页面才能用。
 */
async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/content.js'],
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendToContent<T>(tabId: number, msg: ContentCommand): Promise<T | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, msg)) as T;
  } catch {
    /* 首次失败通常是"扩展更新前就开着的页面"没有内容脚本，注入后重试一次 */
  }
  if (!(await ensureContentScript(tabId))) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, msg)) as T;
  } catch {
    return null;
  }
}

/** 等页面加载到 complete，最多 timeoutMs（用于 canonical + hardRefresh 的"先导航再强刷"） */
async function waitComplete(tabId: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    if (tab.status === 'complete' && !tab.pendingUrl) return;
    await sleep(50);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function executeAutoClick(
  tabId: number,
  selector: string,
  action: ClickAction = 'single',
): Promise<RefreshOutcome> {
  const res = await sendToContent<{ result: 'ok' | 'not-found' | 'invalid' }>(tabId, {
    type: 'AUTOCLICK',
    selector,
    action,
  });
  if (!res) return { ok: false, reason: 'xhr_no_content' };
  const reason: RefreshFailureCode =
    res.result === 'invalid' ? 'xhr_invalid' : res.result === 'not-found' ? 'xhr_not_found' : 'xhr_not_found';
  return res.result === 'ok' ? { ok: true } : { ok: false, reason };
}

/** 探测选择器（面板「测试」按钮）。设计依据 docs/05 §7.1 */
export async function probeSelector(
  tabId: number,
  selector: string,
): Promise<
  { ok: true; count: number; preview: string } | { ok: false; reason: 'xhr_no_content' | 'xhr_not_found' | 'xhr_invalid' }
> {
  const res = await sendToContent<{
    result: 'ok' | 'not-found' | 'invalid';
    count?: number;
    preview?: string;
  }>(tabId, { type: 'TEST_SELECTOR', selector });
  if (!res) return { ok: false, reason: 'xhr_no_content' };
  if (res.result === 'ok') return { ok: true, count: res.count ?? 1, preview: res.preview ?? '' };
  return { ok: false, reason: res.result === 'invalid' ? 'xhr_invalid' : 'xhr_not_found' };
}

/**
 * 执行一轮"刷新"。设计依据 docs/05-refresh-engine.md §3.1 / §3.2 / §7
 *
 * 注意（ADR-008）：完整刷新发出 reload/update 即视为本轮完成，不等页面 `complete`
 * （除非 canonical 模式需要先导航再强刷）。
 */
export async function runRefresh(
  tabId: number,
  opts: {
    refreshType: 'full' | 'xhr';
    hardRefresh: boolean;
    redirection: 'follow' | 'canonical';
    autoClickSelector: string;
    autoClickAction: ClickAction;
    canonicalUrl: string;
    keepActive: boolean;
    ensureKeepActive: (tabId: number) => Promise<void>;
  },
): Promise<RefreshOutcome> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return { ok: false, reason: 'tab_gone' };

  // keep-active 必须在本轮刷新前续期（docs/05 §3.2），否则 reload 期间可能被判后台
  if (opts.keepActive) await opts.ensureKeepActive(tabId);

  if (opts.refreshType === 'xhr') {
    const selector = opts.autoClickSelector.trim();
    if (!selector) return { ok: false, reason: 'xhr_no_selector' };
    return executeAutoClick(tabId, selector, opts.autoClickAction);
  }

  const currentUrl = tab.url ?? '';
  const frozen = Boolean(tab.discarded) || Boolean((tab as { frozen?: boolean }).frozen);

  // 被浏览器丢弃/冻结的页面：直接 reload（ARP `dx()` 的 isFrozen 分支）
  if (frozen) {
    await chrome.tabs.reload(tabId, { bypassCache: opts.hardRefresh });
    return { ok: true };
  }

  // redirection === 'canonical'：先回到开始时的 URL
  if (opts.redirection === 'canonical' && opts.canonicalUrl && opts.canonicalUrl !== currentUrl) {
    await chrome.tabs.update(tabId, { url: opts.canonicalUrl });
    if (opts.hardRefresh) {
      await waitComplete(tabId);
      await chrome.tabs.reload(tabId, { bypassCache: true });
    }
    return { ok: true };
  }

  await chrome.tabs.reload(tabId, { bypassCache: opts.hardRefresh });
  return { ok: true };
}
