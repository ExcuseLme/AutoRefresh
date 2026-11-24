import type { ContentCommand } from './messages';

export type RefreshOutcome = { ok: true } | { ok: false; reason: string };

async function sendToContent<T>(tabId: number, msg: ContentCommand): Promise<T | null> {
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

export async function executeAutoClick(tabId: number, selector: string): Promise<RefreshOutcome> {
  const res = await sendToContent<{ result: 'ok' | 'not-found' | 'invalid' }>(tabId, {
    type: 'AUTOCLICK',
    selector,
  });
  if (!res) return { ok: false, reason: 'xhr-no-content' };
  return res.result === 'ok' ? { ok: true } : { ok: false, reason: `xhr-${res.result}` };
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
    canonicalUrl: string;
    keepActive: boolean;
    ensureKeepActive: (tabId: number) => Promise<void>;
  },
): Promise<RefreshOutcome> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return { ok: false, reason: 'tab-gone' };

  // keep-active 必须在本轮刷新前续期（docs/05 §3.2），否则 reload 期间可能被判后台
  if (opts.keepActive) await opts.ensureKeepActive(tabId);

  if (opts.refreshType === 'xhr') {
    const selector = opts.autoClickSelector.trim();
    if (!selector) return { ok: false, reason: 'xhr-no-selector' };
    return executeAutoClick(tabId, selector);
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
