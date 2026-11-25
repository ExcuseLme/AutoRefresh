import { useEffect, useMemo, useState } from 'react';
import { t } from '@/lib/i18n';
import type { PopupCommand, StateSnapshot } from '@/lib/messages';
import { DEFAULT_OPTIONS, type ClickAction, type Options } from '@/lib/options';
import type { PageSelectorEntry } from '@/lib/page-selectors';
import type { Session } from '@/lib/session';
import { watchOptions } from '@/lib/storage';
import { Header } from '@/components/Header';
import { IntervalSection } from '@/components/IntervalSection';
import { OptionsSection } from '@/components/OptionsSection';
import { RefreshTypeSection } from '@/components/RefreshTypeSection';

async function send<T = unknown>(msg: PopupCommand): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as T;
  } catch {
    return null;
  }
}

export default function App() {
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [session, setSession] = useState<Session | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabUrl, setTabUrl] = useState('');
  const [ready, setReady] = useState(false);
  // ADR-022：当前页面的 per-page 配置
  const [pageSelector, setPageSelector] = useState<PageSelectorEntry | null>(null);
  const [pageKey, setPageKey] = useState<string | null>(null);
  const [sessionPageKey, setSessionPageKey] = useState<string | null>(null);

  /** 把一次快照灌进本地状态（首屏与轮询共用同一份逻辑） */
  const applySnapshot = (snap: StateSnapshot): void => {
    setSession(snap.session);
    setTabUrl(snap.tabUrl);
    setPageSelector(snap.pageSelector);
    setPageKey(snap.pageKey);
    setSessionPageKey(snap.sessionPageKey);
  };

  // 首屏拉一次状态
  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const id = tab?.id ?? null;
      setTabId(id);
      if (id === null) {
        setReady(true);
        return;
      }
      const snap = await send<StateSnapshot>({ type: 'GET_STATE', tabId: id });
      if (snap) {
        setOptions(snap.options);
        applySnapshot(snap);
      }
      setReady(true);
    })();
  }, []);

  // 配置变化（含本面板发起的 patch，storage.onChanged 会广播回来）
  useEffect(() => watchOptions(setOptions), []);

  // 会话状态没有推送通道，靠轻轮询（面板通常只开几秒，成本可忽略）
  useEffect(() => {
    if (tabId === null) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const snap = await send<StateSnapshot>({ type: 'GET_STATE', tabId });
      if (!cancelled && snap) applySnapshot(snap);
    };
    const timer = setInterval(() => void tick(), 500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tabId]);

  /**
   * 写当前页面的 selector / 触发方式（ADR-022）。
   *
   * 注意这里**不走 OPTIONS_PATCH**：per-page 配置存在独立的 `pageSelectors` 键，
   * 由 SW 的 SELECTOR_SET / CLICK_ACTION_SET 写。
   */
  const setSelector = useMemo(
    () =>
      async (selector: string): Promise<{ ok: boolean; code?: string }> => {
        if (tabId === null) return { ok: false, code: 'err_page_unavailable' };
        const res = await send<{ ok: boolean; code?: string }>({ type: 'SELECTOR_SET', tabId, selector });
        return res ?? { ok: false, code: 'err_page_unavailable' };
      },
    [tabId],
  );

  const setAction = useMemo(
    () =>
      async (action: ClickAction): Promise<{ ok: boolean; code?: string }> => {
        if (tabId === null) return { ok: false, code: 'err_page_unavailable' };
        const res = await send<{ ok: boolean; code?: string }>({ type: 'CLICK_ACTION_SET', tabId, action });
        return res ?? { ok: false, code: 'err_page_unavailable' };
      },
    [tabId],
  );

  const patch = useMemo(
    () =>
      async (next: Partial<Options>): Promise<{ ok: boolean; code?: string }> => {
        const res = await send<{ ok: boolean; issues?: { field: string; code: string }[] }>({
          type: 'OPTIONS_PATCH',
          patch: next,
        });
        if (!res) return { ok: false };
        if (!res.ok) return { ok: false, code: res.issues?.[0]?.code };
        return { ok: true };
      },
    [],
  );

  const control = useMemo(
    () => ({
      start: async () => {
        if (tabId === null) return 'err_page_unavailable';
        const res = await send<{ ok: boolean; code?: string }>({ type: 'START', tabId });
        return res && !res.ok ? (res.code ?? 'err_page_unavailable') : null;
      },
      stop: async () => {
        if (tabId === null) return;
        await send({ type: 'STOP', tabId });
      },
      pause: async () => {
        if (tabId === null) return;
        await send({ type: 'PAUSE', tabId });
      },
      resume: async () => {
        if (tabId === null) return;
        await send({ type: 'RESUME', tabId });
      },
    }),
    [tabId],
  );

  /** 探测选择器：把 SW 的三种失败 code 翻成面板可读文案（docs/05 §7.1） */
  const probe = useMemo(
    () =>
      async (
        selector: string,
      ): Promise<
        | { kind: 'idle' }
        | { kind: 'testing' }
        | { kind: 'ok'; count: number; preview: string }
        | { kind: 'fail'; message: string }
      > => {
        if (tabId === null) return { kind: 'fail', message: t('err_page_unavailable') };
        const res = await send<
          { ok: true; count: number; preview: string } | { ok: false; reason: string }
        >({ type: 'TEST_SELECTOR', tabId, selector });
        if (!res) return { kind: 'fail', message: t('xhr_no_content') };
        if (res.ok) return { kind: 'ok', count: res.count, preview: res.preview };
        // 测试按钮的文案用"探测"口径（不带"本轮未刷新"，因为这里本来就不刷新）
        const message =
          res.reason === 'xhr_invalid'
            ? t('selector_test_invalid')
            : res.reason === 'xhr_not_found'
              ? t('selector_test_none')
              : t(res.reason);
        return { kind: 'fail', message };
      },
    [tabId],
  );

  /** 进入元素拾取模式（ADR-018）。popup 会在用户去页面点选时被关闭，结果由 SW 落库 */
  const pick = useMemo(
    () =>
      async (): Promise<{ ok: boolean; message?: string }> => {
        if (tabId === null) return { ok: false, message: t('err_page_unavailable') };
        const res = await send<{ ok: boolean; code?: string }>({ type: 'PICKER_START', tabId });
        if (!res) return { ok: false, message: t('err_picker_unavailable') };
        if (!res.ok) return { ok: false, message: t(res.code ?? 'err_picker_unavailable') };
        // 成功：popup 即将因用户去页面点选而关闭，无需再更新界面
        return { ok: true };
      },
    [tabId],
  );

  return (
    <div className="flex max-h-[560px] flex-col bg-[var(--background)]">
      <Header session={session} options={options} control={control} />
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 py-2">
        {!ready ? (
          <p className="px-1 py-4 text-center text-[11px] text-[var(--muted-foreground)]">{t('status_loading')}</p>
        ) : (
          <>
            {/*
             * ADR-027：把「间隔」与「刷新类型」粘成**同一个视觉组** ——
             * 外层画一次卡片边框，内部用分隔线切行，不再是两张独立卡片。
             */}
            <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
              <IntervalSection options={options} patch={patch} fused />
              <div className="border-t border-[var(--border)]" />
              <RefreshTypeSection
                options={options}
                patch={patch}
                probe={probe}
                pick={pick}
                pageSelector={pageSelector}
                sessionPageKey={sessionPageKey}
                pageKey={pageKey}
                setSelector={setSelector}
                setAction={setAction}
                fused
              />
            </div>
            <OptionsSection options={options} patch={patch} />
          </>
        )}
      </div>
    </div>
  );
}
