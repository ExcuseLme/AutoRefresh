import { SegmentedControl } from './ui';

import { t } from '@/lib/i18n';
import type { Options, RefreshType } from '@/lib/options';

type PatchFn = (next: Partial<Options>) => Promise<{ ok: boolean; code?: string }>;

const TYPE_ITEMS = [
  { value: 'full' as const, labelKey: 'refresh_full_page', descKey: 'refresh_full_page_desc' },
  { value: 'xhr' as const, labelKey: 'refresh_xhr', descKey: 'refresh_xhr_desc' },
];

export function RefreshTypeSection({ options, patch }: { options: Options; patch: PatchFn }) {
  const current = TYPE_ITEMS.find((i) => i.value === options.refreshType) ?? TYPE_ITEMS[0]!;

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
            <p className="mb-1.5 text-xs text-[var(--muted-foreground)]">{t('refresh_xhr_selector')}</p>
            <input
              type="text"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 font-mono text-xs text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
              placeholder={t('refresh_xhr_selector_placeholder')}
              aria-label={t('refresh_xhr_selector')}
              value={options.autoClickSelector}
              onChange={(e) => void patch({ autoClickSelector: e.currentTarget.value })}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
