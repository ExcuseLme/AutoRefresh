import { useState } from 'react';
import { SegmentedControl } from './ui';

import { t } from '@/lib/i18n';
import type { Options, RefreshType } from '@/lib/options';

type PatchFn = (next: Partial<Options>) => Promise<{ ok: boolean; code?: string }>;

const TYPE_ITEMS = [
  { value: 'full' as const, labelKey: 'refresh_full_page', descKey: 'refresh_full_page_desc' },
  { value: 'xhr' as const, labelKey: 'refresh_xhr', descKey: 'refresh_xhr_desc' },
];

/** 选择器探测结果（面板内展示，docs/05 §7.1） */
type ProbeState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; count: number; preview: string }
  | { kind: 'fail'; message: string };

export function RefreshTypeSection({
  options,
  patch,
  probe,
}: {
  options: Options;
  patch: PatchFn;
  probe: (selector: string) => Promise<ProbeState>;
}) {
  const current = TYPE_ITEMS.find((i) => i.value === options.refreshType) ?? TYPE_ITEMS[0]!;
  const [probeState, setProbeState] = useState<ProbeState>({ kind: 'idle' });

  const selector = options.autoClickSelector;

  const onTest = async () => {
    setProbeState({ kind: 'testing' });
    const res = await probe(selector);
    setProbeState(res);
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
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-xs text-[var(--muted-foreground)]">{t('refresh_xhr_selector')}</p>
              <button
                type="button"
                onClick={() => void onTest()}
                disabled={probeState.kind === 'testing' || selector.trim() === ''}
                className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:border-[var(--primary)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {probeState.kind === 'testing' ? t('status_loading') : t('selector_test')}
              </button>
            </div>
            <input
              type="text"
              name="autoClickSelector"
              autoComplete="off"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 font-mono text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
              placeholder={t('refresh_xhr_selector_placeholder')}
              aria-label={t('refresh_xhr_selector')}
              value={selector}
              onChange={(e) => {
                setProbeState({ kind: 'idle' });
                void patch({ autoClickSelector: e.currentTarget.value });
              }}
            />
            {probeState.kind === 'ok' ? (
              <p className="mt-1.5 text-[11px] leading-tight text-[var(--primary)]">
                {t('selector_test_ok', [probeState.count])}
                <span className="font-mono">{probeState.preview}</span>
              </p>
            ) : null}
            {probeState.kind === 'fail' ? (
              <p className="mt-1.5 text-[11px] leading-tight text-[var(--destructive)]">{probeState.message}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
