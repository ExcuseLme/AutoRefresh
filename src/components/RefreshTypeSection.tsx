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
 * 刷新类型 + XHR 的「自动点击元素选择器」（紧凑版）。ADR-018/020/022/023
 *
 * ADR-022：selector 与触发方式按页面（URL）隔离。面板读写"当前标签页这个 URL"的记录。
 * 紧凑化手段：说明文字并入标题行右侧、选择器输入框与两个按钮同一行、
 * 「触发方式」与说明同一行，不再各占一整行。
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
  pick: () => Promise<{ ok: boolean; message?: string }>;
  pageSelector: PageSelectorEntry | null;
  sessionPageKey: string | null;
  pageKey: string | null;
  setSelector: (selector: string) => Promise<{ ok: boolean; code?: string }>;
  setAction: (action: ClickAction) => Promise<{ ok: boolean; code?: string }>;
}) {
  const current = TYPE_ITEMS.find((i) => i.value === options.refreshType) ?? TYPE_ITEMS[0]!;
  const [probeState, setProbeState] = useState<ProbeState>({ kind: 'idle' });
  const [picking, setPicking] = useState(false);

  const selector = pageSelector?.selector ?? '';
  const action: ClickAction = pageSelector?.action ?? 'single';
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

  return (
    <section className="flex flex-col gap-1.5">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5">
        {/* 标题 + 说明同一行，省掉一整段说明占位 */}
        <div className="mb-1 flex items-baseline gap-2">
          <p className="shrink-0 text-[10.5px] font-medium text-[var(--muted-foreground)]">{t('refresh_type')}</p>
          <p className="min-w-0 truncate text-[10.5px] text-[var(--muted-foreground)]/80">{t(current.descKey)}</p>
        </div>
        <SegmentedControl
          value={options.refreshType}
          ariaLabel={t('refresh_type')}
          items={TYPE_ITEMS.map((i) => ({ value: i.value, label: t(i.labelKey) }))}
          onChange={(v) => void patch({ refreshType: v as RefreshType })}
        />

        {options.refreshType === 'xhr' ? (
          <>
            <div className="mt-1.5 flex flex-col gap-1 border-t border-[var(--border)] pt-1.5">
              {/* 标签 + 两个按钮同一行 */}
              <div className="flex items-center gap-1.5">
                <p className="min-w-0 flex-1 truncate text-[10.5px] text-[var(--muted-foreground)]">
                  {t('refresh_xhr_selector')}
                </p>
                <SmallButton onClick={() => void onPick()} disabled={picking}>
                  {picking ? t('pick_element_active') : t('pick_element')}
                </SmallButton>
                <SmallButton onClick={() => void onTest()} disabled={probeState.kind === 'testing' || selector.trim() === ''}>
                  {probeState.kind === 'testing' ? t('status_loading') : t('selector_test')}
                </SmallButton>
              </div>

              <input
                type="text"
                name="autoClickSelector"
                autoComplete="off"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 font-mono text-[11px] text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
                placeholder={t('refresh_xhr_selector_placeholder')}
                aria-label={t('refresh_xhr_selector')}
                value={selector}
                onChange={(e) => void setSelector(e.currentTarget.value)}
              />

              {/* 所有辅助信息压成一行小字：页面隔离提示 / 探测结果 / 会话提示
                  ADR-025：每条都 truncate + title，超长 URL 不得把面板撑宽 */}
              <div className="flex flex-col gap-0.5 text-[10.5px] leading-tight">
                <p className="truncate text-[var(--muted-foreground)]" title={pageKey ?? undefined}>
                  {pageKey ? t('selector_scope_hint', [pageKey]) : t('selector_scope_unavailable')}
                </p>
                {probeState.kind === 'ok' ? (
                  <p className="truncate text-[var(--primary)]" title={`${t('selector_test_ok', [probeState.count])}${probeState.preview}`}>
                    {t('selector_test_ok', [probeState.count])}
                    <span className="font-mono">{probeState.preview}</span>
                  </p>
                ) : null}
                {probeState.kind === 'fail' ? (
                  <p className="text-[var(--destructive)]">{probeState.message}</p>
                ) : null}
                {sessionElsewhere ? (
                  <p className="truncate text-[var(--muted-foreground)]" title={sessionPageKey ?? undefined}>
                    {t('selector_session_elsewhere', [sessionPageKey ?? ''])}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-1.5 flex items-center gap-2 border-t border-[var(--border)] pt-1.5">
              <p className="shrink-0 text-[10.5px] text-[var(--muted-foreground)]">{t('click_action')}</p>
              <div className="w-[124px] shrink-0">
                <SegmentedControl
                  value={action}
                  ariaLabel={t('click_action')}
                  items={ACTION_ITEMS.map((i) => ({ value: i.value, label: t(i.labelKey) }))}
                  onChange={(v) => void setAction(v as ClickAction)}
                />
              </div>
              <p className="min-w-0 flex-1 text-[10.5px] leading-tight text-[var(--muted-foreground)]">
                {action === 'double' ? t('click_double_desc') : t('click_single_desc')}
              </p>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function SmallButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10.5px] font-medium leading-tight text-[var(--muted-foreground)] transition hover:border-[var(--primary)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
