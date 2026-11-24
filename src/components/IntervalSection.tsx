import { useState } from 'react';
import { NumberStepper, SegmentedControl } from './ui';
import { t } from '@/lib/i18n';
import { FIXED_PRESETS, type IntervalMode, type Options } from '@/lib/options';

type PatchFn = (next: Partial<Options>) => Promise<{ ok: boolean; code?: string }>;

const MODE_ITEMS = [
  { value: 'fixed' as const, labelKey: 'interval_fixed' },
  { value: 'random' as const, labelKey: 'interval_random' },
  { value: 'custom' as const, labelKey: 'interval_custom' },
];

export function IntervalSection({ options, patch }: { options: Options; patch: PatchFn }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setMode = (mode: IntervalMode) => {
    setError(null);
    void patch({ intervalMode: mode });
  };

  const selectPreset = (preset: (typeof FIXED_PRESETS)[number]) => {
    setError(null);
    setCustomOpen(false);
    void patch({ intervalMode: 'fixed', fixedPreset: preset, fixedSeconds: preset });
  };

  const applyCustom = async (seconds: number) => {
    const res = await patch({ customSeconds: seconds, intervalMode: 'custom' });
    setError(res.ok ? null : t(res.code ?? 'err_interval_positive'));
  };

  const applyRandom = async (which: 'min' | 'max', seconds: number) => {
    const res = await patch(
      which === 'min' ? { randomMinSeconds: seconds } : { randomMaxSeconds: seconds },
    );
    setError(res.ok ? null : t(res.code ?? 'err_random_range'));
  };

  const isPresetActive = options.intervalMode === 'fixed' && !customOpen;
  const customChipActive = options.intervalMode === 'custom' || (options.intervalMode === 'fixed' && customOpen);

  return (
    <section className="flex flex-col gap-2.5">
      <SegmentedControl
        value={options.intervalMode}
        items={MODE_ITEMS.map((m) => ({ value: m.value, label: t(m.labelKey) }))}
        onChange={(v) => setMode(v as IntervalMode)}
        ariaLabel={t('interval_title')}
      />

      {options.intervalMode === 'fixed' ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="flex items-center justify-between px-4 pt-3">
            <p className="text-xs text-[var(--muted-foreground)]">{t('interval_title')}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{t('interval_seconds_label')}</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2">
            <StepButton
              label={t('interval_decrease_by')}
              onClick={() =>
                selectPreset(nextPresetDown(options.fixedPreset) as (typeof FIXED_PRESETS)[number])
              }
            />
            <div className="flex-1 text-center">
              <span className="tnum text-3xl font-bold text-[var(--foreground)]">{options.fixedSeconds}</span>
            </div>
            <StepButton
              label={t('interval_increase_by')}
              onClick={() =>
                selectPreset(nextPresetUp(options.fixedPreset) as (typeof FIXED_PRESETS)[number])
              }
            />
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-[var(--border)] px-4 py-3">
            {FIXED_PRESETS.map((preset) => (
              <Chip key={preset} active={isPresetActive && options.fixedPreset === preset} onClick={() => selectPreset(preset)}>
                {t('interval_preset_seconds', [preset])}
              </Chip>
            ))}
            <Chip active={customChipActive} onClick={() => setCustomOpen(true)}>
              {t('interval_custom_chip')}
            </Chip>
          </div>
          {customOpen ? (
            <div className="border-t border-[var(--border)] px-4 py-3">
              <NumberStepper
                value={options.customSeconds}
                min={1}
                max={86400}
                ariaLabel={t('aria_interval_seconds')}
                onSubmit={(v) => void applyCustom(v)}
                autoFocus
              />
              <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                {t('interval_custom_summary', [options.customSeconds])}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {options.intervalMode === 'random' ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="mb-2.5 text-xs text-[var(--muted-foreground)]">{t('interval_random_range')}</p>
          <div className="flex gap-2">
            <LabeledInt
              label={t('interval_min_sec')}
              value={options.randomMinSeconds}
              min={1}
              max={86400}
              ariaLabel={t('aria_random_min')}
              onCommit={(v) => void applyRandom('min', v)}
            />
            <LabeledInt
              label={t('interval_max_sec')}
              value={options.randomMaxSeconds}
              min={1}
              max={86400}
              ariaLabel={t('aria_random_max')}
              onCommit={(v) => void applyRandom('max', v)}
            />
          </div>
          <p
            className={[
              'mt-2.5 text-[11px]',
              options.randomMaxSeconds < options.randomMinSeconds
                ? 'text-[var(--destructive)]'
                : 'text-[var(--muted-foreground)]',
            ].join(' ')}
          >
            {options.randomMaxSeconds < options.randomMinSeconds
              ? t('err_random_range')
              : t('interval_random_summary', [options.randomMinSeconds, options.randomMaxSeconds])}
          </p>
        </div>
      ) : null}

      {options.intervalMode === 'custom' ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="mb-2.5 text-xs text-[var(--muted-foreground)]">{t('interval_custom_value')}</p>
          <NumberStepper
            value={options.customSeconds}
            min={1}
            max={86400}
            ariaLabel={t('aria_interval_seconds')}
            onSubmit={(v) => void applyCustom(v)}
          />
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            {t('interval_custom_summary', [options.customSeconds])}
          </p>
        </div>
      ) : null}

      {error ? <p className="text-[11px] leading-tight text-[var(--destructive)]">{error}</p> : null}
    </section>
  );
}

function nextPresetUp(current: number): number {
  const idx = FIXED_PRESETS.indexOf(current as (typeof FIXED_PRESETS)[number]);
  if (idx === -1) return FIXED_PRESETS[0];
  return FIXED_PRESETS[Math.min(FIXED_PRESETS.length - 1, idx + 1)] ?? current;
}

function nextPresetDown(current: number): number {
  const idx = FIXED_PRESETS.indexOf(current as (typeof FIXED_PRESETS)[number]);
  if (idx === -1) return FIXED_PRESETS[0];
  return FIXED_PRESETS[Math.max(0, idx - 1)] ?? current;
}

function StepButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--secondary)] text-[var(--secondary-foreground)] transition hover:border-[var(--primary)]"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        {label.includes('减少') || label.includes('decrease') ? (
          <path d="M5 12h14" strokeLinecap="round" />
        ) : (
          <>
            <path d="M5 12h14" strokeLinecap="round" />
            <path d="M12 5v14" strokeLinecap="round" />
          </>
        )}
      </svg>
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded-full border px-3 py-1 font-mono text-xs font-medium transition',
        active
          ? 'border-[var(--accent-border)] bg-[var(--accent)] text-[var(--accent-foreground)]'
          : 'border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)] hover:border-[var(--primary)]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function LabeledInt({
  label,
  value,
  min,
  max,
  ariaLabel,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  ariaLabel: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  const shown = focused ? draft : String(value);

  const commit = () => {
    setFocused(false);
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isInteger(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <label className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2">
      <span className="block text-[11px] text-[var(--muted-foreground)]">{label}</span>
      <input
        type="number"
        className="no-spinner tnum w-full bg-transparent text-base font-semibold text-[var(--foreground)] outline-none"
        aria-label={ariaLabel}
        value={shown}
        min={min}
        max={max}
        onFocus={() => {
          setFocused(true);
          setDraft(String(value));
        }}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
