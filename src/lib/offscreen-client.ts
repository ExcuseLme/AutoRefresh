/**
 * offscreen 文档的客户端封装（SW 侧）。设计依据 docs/05-refresh-engine.md §1.2
 *
 * 责任：
 * - 懒创建 offscreen 文档（`chrome.offscreen.createDocument`，reasons: WORKERS/DOM_SCRAPING 都可，
 *   这里用 `WORKERS` 表示"有一个后台执行上下文"，不需要 DOM 能力）
 * - 发 ARM/DISARM/PING 并等待响应
 * - 60s 存活探测；失活时销毁重建（由 engine 的定时巡逻触发）
 */

const OFFSCREEN_PATH = 'offscreen.html';

let creating: Promise<void> | null = null;

function isOffscreenAvailable(): boolean {
  return typeof chrome.offscreen !== 'undefined';
}

export async function ensureOffscreen(): Promise<boolean> {
  if (!isOffscreenAvailable()) return false;

  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
    });
    if (contexts.length > 0) return true;
  } catch {
    /* 老版本 Chrome 不支持 getContexts，走下面的 createDocument 兜底 */
  }

  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: '托管页面自动刷新的精确计时器',
      })
      .catch((err: unknown) => {
        // 已存在时 Chrome 会抛 "Only a single offscreen document may be created"
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('single offscreen')) throw err;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
  return true;
}

export async function closeOffscreen(): Promise<void> {
  if (!isOffscreenAvailable()) return;
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    /* 不存在时忽略 */
  }
}

/** 发消息给 offscreen，失败返回 null（调用方可据此触发重建） */
async function postToOffscreen<T = unknown>(payload: Record<string, unknown>): Promise<T | null> {
  try {
    return await chrome.runtime.sendMessage({ to: 'offscreen', ...payload });
  } catch {
    return null;
  }
}

export async function armTimer(tabId: number, token: string, delayMs: number): Promise<boolean> {
  if (!(await ensureOffscreen())) return false;
  const res = await postToOffscreen<{ ok: boolean }>({ type: 'ARM', tabId, token, delayMs });
  return Boolean(res?.ok);
}

export async function disarmTimer(tabId?: number): Promise<void> {
  await postToOffscreen({ type: 'DISARM', tabId });
}

export async function pingOffscreen(): Promise<boolean> {
  if (!(await ensureOffscreen())) return false;
  const res = await postToOffscreen<{ type: string; armed: number }>({ type: 'PING' });
  return res?.type === 'PONG';
}

/**
 * 让 offscreen 每秒刷新该标签页的徽章倒计时（ADR-031）。
 *
 * @param dueAt  本轮到点的绝对时间戳（`Date.now()` 基准，与 Session 的 `armedAt + delayMs` 同源）
 * @param delayMs 本轮时长，仅用于"是否值得启动 watch"的判断
 */
export async function watchBadge(tabId: number, dueAt: number, delayMs: number): Promise<boolean> {
  // 短于一秒的间隔没有"每秒刷新"的意义，直接由 SW 画一次静态数字即可
  if (delayMs < 1000) {
    await stopBadgeWatch(tabId);
    return false;
  }
  if (!(await ensureOffscreen())) return false;
  const res = await postToOffscreen<{ ok: boolean }>({ type: 'BADGE_WATCH', tabId, dueAt });
  return Boolean(res?.ok);
}

export async function stopBadgeWatch(tabId?: number): Promise<void> {
  await postToOffscreen({ type: 'BADGE_UNWATCH', tabId });
}
