import type { Session } from './session';

const KEY = 'sessions';

/** 镜像会话到 storage.session，供 SW 被回收后恢复（docs/03 §4） */
export async function loadSessions(): Promise<Map<number, Session>> {
  try {
    const raw = await chrome.storage.session.get(KEY);
    const data = raw[KEY];
    if (!data || typeof data !== 'object') return new Map();
    const map = new Map<number, Session>();
    for (const [k, v] of Object.entries(data as Record<string, Session>)) {
      const id = Number(k);
      if (Number.isFinite(id) && v && typeof v === 'object') map.set(id, v);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function saveSessions(map: Map<number, Session>): Promise<void> {
  const plain: Record<string, Session> = {};
  for (const [id, s] of map) plain[String(id)] = s;
  try {
    await chrome.storage.session.set({ [KEY]: plain });
  } catch {
    /* storage.session 在极少数情况下不可用，忽略 */
  }
}
