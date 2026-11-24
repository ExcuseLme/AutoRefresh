import { installKeepActive, KEEP_ACTIVE_STORAGE_KEY, KEEP_ACTIVE_TTL_MS } from './keep-active';

/** 以 MAIN world 注入反隐藏补丁（docs/05 §6.1） */
export async function injectKeepActive(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: installKeepActive,
    });
    return true;
  } catch {
    return false;
  }
}

/** 写 sessionStorage TTL，供页面重载后由内容脚本自愈（docs/05 §6.2） */
export async function writeKeepActiveTtl(tabId: number, enabled: boolean): Promise<void> {
  const expiresAt = enabled ? Date.now() + KEEP_ACTIVE_TTL_MS : 0;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      args: [KEEP_ACTIVE_STORAGE_KEY, expiresAt],
      func: (key: string, value: number) => {
        try {
          if (value > 0) sessionStorage.setItem(key, String(value));
          else sessionStorage.removeItem(key);
        } catch {
          /* 忽略 */
        }
      },
    });
  } catch {
    /* 页面不可注入时忽略 */
  }
}

/** 每轮刷新前的续期：先补 TTL，再重打补丁（幂等） */
export async function ensureKeepActive(tabId: number): Promise<void> {
  await writeKeepActiveTtl(tabId, true);
  await injectKeepActive(tabId);
}

/** 停止时清理：删 TTL 并通知内容脚本（页面上的原型补丁无法撤销，只能随下次导航消失） */
export async function clearKeepActive(tabId: number): Promise<void> {
  await writeKeepActiveTtl(tabId, false);
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_KEEP_ACTIVE' });
  } catch {
    /* 内容脚本不在时忽略 */
  }
}

/** 让后台标签页不被 Chrome 丢弃（docs/05 §6.3） */
export async function setAutoDiscardable(tabId: number, discardable: boolean): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: discardable });
  } catch {
    /* 忽略 */
  }
}
