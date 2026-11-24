import { useState } from 'react';
import { SegmentedControl } from './ui';

import { t } from '@/lib/i18n';
import type { ClickAction, Options, RefreshType } from '@/lib/options';
import type { PageSelectorEntry } from '@/lib/page-selectors';

type PatchFn = (next: Partial<Options>) => Promise<{ ok: boolean; code?: string }>;

const TYPE_ITEMS = [
  { value: 'full' as const, labelKey: 'refresh_full_page', descKey: 'refresh_full_page_desc' },
  { value: 'xhr' as const, labelKey: 'refresh_xhr', descKey: 'refresh_xhr_desc' },
];

const ACTION_ITEMS = [
  { value: 'single' as const, labelKey: 'click_single' },
  { value: 'double' as const, labelKey: 'click_double' },
];

/** 选择器探测结果（面板内展示，docs/05 §7.4） */
type ProbeState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; count: number; preview: string }
  | { kind: 'fail'; message: string };

/**
 * 刷新类型段落 + XHR 的「自动点击元素选择器」。
 *
 * ADR-022：selector 与触发方式**按页面（URL）隔离**，不再是全局字段。
 * 面板读写的是"当前标签页这个 URL"的记录，所以：
 *   - 在 A 页配好并跑起来，去 B 页改配置不会影响 A 页正在跑的会话
 *   - 运行中的会话锁定的是它启动时那个页面的配置
 */
export function RefreshTypeSection({
  options,
  patch,
  probe,
  pick,
  pageSelector,
  sessionPageKey,
  pageKey,
  setSelector,
  setAction,
}: {
  options: Options;
  patch: PatchFn;
  probe: (selector: string) => Promise<ProbeState>;
  /** 进入元素拾取模式（ADR-018）；面板会在用户去页面点选时被关闭 */
  pick: () => Promise<{ ok: boolean; message?: string }>;
  /** 当前页面的 per-page 配置（没有就是 null） */
  pageSelector: PageSelectorEntry | null;
  /** 运行中会话锁定的 pageKey（没有会话就是 null） */
  sessionPageKey: string | null;
  /** 当前页面的 pageKey */
  pageKey: string | null;
  /** 写当前页面的 selector（ADR-022） */
  setSelector: (selector: string) => Promise<{ ok: boolean; code?: string }>;
  /** 写当前页面的触发方式（ADR-022） */
  setAction: (action: ClickAction) => Promise<{ ok: boolean; code?: string }>;
}) {
  const current = TYPE_ITEMS.find((i) => i.value === options.refreshType) ?? TYPE_ITEMS[0]!;
  const [probeState, setProbeState] = useState<ProbeState>({ kind: 'idle' });
  const [picking, setPicking] = useState(false);

  const selector = pageSelector?.selector ?? '';
  const action: ClickAction = pageSelector?.action ?? 'single';

  /** 会话在其他页面跑着：面板改的配置不会影响那个会话，必须告诉用户 */
  const sessionElsewhere = sessionPageKey !== null && pageKey !== null && sessionPageKey !== pageKey;

  const onTest = async () => {
    setProbeState({ kind: 'testing' });
    setProbeState(await probe(selector));
  };

  const onPick = async () => {
    setPicking(true);
    setProbeState({ kind: 'idle' });
    const res = await pick();
    setPicking(false);
    if (!res.ok && res.message) setProbeState({ kind: 'fail', message: res.message });
  };

  const onSelectorInput = async (value: string) => {
    setProbeState({ kind: 'idle' });
    await setSelector(value);
  };

  const onActionChange = async (next: ClickAction) => {
    // 还没选过元素时就只是"预选"，不建空壳记录（拾取时会一并写入）
    await setAction(next);
  };

  return (
    <section className="flex flex-col gap-2.5">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="mb-2.5 text-xs text-[var(--muted-foreground)]">{t('refresh_type')}</p>
        <SegmentedControl
          value={options.refreshType}
          ariaLabel={t('refresh_type')}
          items={TYPE_ITEMS.map((i) => ({ value: i.value, label: t(i.labelKey) }))}
          onChange={(v) => void patch({ refreshType: v as RefreshType })}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{t(current.descKey)}</p>

        {options.refreshType === 'xhr' ? (
          <>
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--muted-foreground)]">{t('refresh_xhr_selector')}</p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void onPick()}
                    disabled={picking}
                    className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:border-[var(--primary)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {picking ? t('pick_element_active') : t('pick_element')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onTest()}
                    disabled={probeState.kind === 'testing' || selector.trim() === ''}
                    className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:border-[var(--primary)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {probeState.kind === 'testing' ? t('status_loading') : t('selector_test')}
                  </button>
                </div>
              </div>
              <input
                type="text"
                name="autoClickSelector"
                autoComplete="off"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 font-mono text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
                placeholder={t('refresh_xhr_selector_placeholder')}
                aria-label={t('refresh_xhr_selector')}
                value={selector}
                onChange={(e) => void onSelectorInput(e.currentTarget.value)}
              />
              {/* 按页面隔离的说明 + 没有配置时的引导 */}
              <p className="mt-1.5 text-[11px] leading-tight text-[var(--muted-foreground)]">
                {pageKey ? t('selector_scope_hint', [pageKey]) : t('selector_scope_unavailable')}
              </p>
              {probeState.kind === 'ok' ? (
                <p className="mt-1.5 text-[11px] leading-tight text-[var(--primary)]">
                  {t('selector_test_ok', [probeState.count])}
                  <span className="font-mono">{probeState.preview}</span>
                </p>
              ) : null}
              {probeState.kind === 'fail' ? (
                <p className="mt-1.5 text-[11px] leading-tight text-[var(--destructive)]">{probeState.message}</p>
              ) : null}
              {sessionElsewhere ? (
                <p className="mt-1.5 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-1.5 text-[11px] leading-tight text-[var(--muted-foreground)]">
                  {t('selector_session_elsewhere', [sessionPageKey ?? ''])}
                </p>
              ) : null}
            </div>

            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <p className="mb-1.5 text-xs text-[var(--muted-foreground)]">{t('click_action')}</p>
              <div className="max-w-[220px]">
                <SegmentedControl
                  value={action}
                  ariaLabel={t('click_action')}
                  items={ACTION_ITEMS.map((i) => ({ value: i.value, label: t(i.labelKey) }))}
                  onChange={(v) => void onActionChange(v as ClickAction)}
                />
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                {action === 'double' ? t('click_double_desc') : t('click_single_desc')}
              </p>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
