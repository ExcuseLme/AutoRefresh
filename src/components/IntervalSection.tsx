import { useState } from 'react';
import { NumberStepper, SegmentedControl } from './ui';
import { t } from '@/lib/i18n';
import { parseIntInRange } from '@/lib/number-input';
import { FIXED_PRESETS, MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS, type IntervalMode, type Options } from '@/lib/options';

type PatchFn = (next: Partial<Options>) => Promise<{ ok: boolean; code?: string }>;

const MODE_ITEMS = [
  { value: 'fixed' as const, labelKey: 'interval_fixed' },
  { value: 'random' as const, labelKey: 'interval_random' },
];

/**
 * 间隔段落（紧凑版）。设计依据 docs/04 §4.1 / ADR-021 / ADR-023
 *
 * 核心约定：**只有一个数字输入组件**，它是固定档唯一的数据来源。
 *   - 点 −/+          ⇒ 对当前数字 ∓1
 *   - 点预设 chip      ⇒ 把该数字"上屏"到输入框
 *   - 手动点数字并输入 ⇒ 直接改这个数字
 * 三者都写同一字段 `fixedSeconds`，并立即落库。
 */
export function IntervalSection({ options, patch }: { options: Options; patch: PatchFn }) {
  const [error, setError] = useState<string | null>(null);

  const setMode = (mode: IntervalMode) => {
    setError(null);
    void patch({ intervalMode: mode });
  };

  const applyFixed = async (seconds: number) => {
    setError(null);
    const res = await patch({ fixedSeconds: seconds });
    if (!res.ok) setError(t(res.code ?? 'err_interval_positive'));
  };

  const applyRandom = async (which: 'min' | 'max', seconds: number) => {
    const res = await patch(
      which === 'min' ? { randomMinSeconds: seconds } : { randomMaxSeconds: seconds },
    );
    setError(res.ok ? null : t(res.code ?? 'err_random_range'));
  };

  return (
    <section className="flex flex-col gap-1.5">
      <SegmentedControl
        value={options.intervalMode}
        items={MODE_ITEMS.map((m) => ({ value: m.value, label: t(m.labelKey) }))}
        onChange={(v) => setMode(v as IntervalMode)}
        ariaLabel={t('interval_title')}
      />

      {options.intervalMode === 'fixed' ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5">
          {/* 一行放下：− 数字 + 秒 ｜快捷 chip（右侧原本空白，正好容下 4 个 chip） */}
          <div className="flex items-center gap-1.5">
            <div className="w-[128px] shrink-0">
              <NumberStepper
                value={options.fixedSeconds}
                min={MIN_INTERVAL_SECONDS}
                max={MAX_INTERVAL_SECONDS}
                ariaLabel={t('aria_interval_seconds')}
                name="fixedSeconds"
                onSubmit={(v) => void applyFixed(v)}
                decreaseLabel={t('interval_decrease_by')}
                increaseLabel={t('interval_increase_by')}
              />
            </div>
            <span className="shrink-0 text-[10.5px] text-[var(--muted-foreground)]">
              {t('interval_seconds_label')}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {FIXED_PRESETS.map((preset) => (
                <Chip
                  key={preset}
                  active={options.fixedSeconds === preset}
                  onClick={() => void applyFixed(preset)}
                >
                  {t('interval_preset_seconds', [preset])}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {options.intervalMode === 'random' ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5">
          <div className="flex items-center gap-2">
            <LabeledInt
              label={t('interval_min_sec')}
              value={options.randomMinSeconds}
              min={MIN_INTERVAL_SECONDS}
              max={MAX_INTERVAL_SECONDS}
              ariaLabel={t('aria_random_min')}
              name="randomMinSeconds"
              onCommit={(v) => void applyRandom('min', v)}
            />
            <LabeledInt
              label={t('interval_max_sec')}
              value={options.randomMaxSeconds}
              min={MIN_INTERVAL_SECONDS}
              max={MAX_INTERVAL_SECONDS}
              ariaLabel={t('aria_random_max')}
              name="randomMaxSeconds"
              onCommit={(v) => void applyRandom('max', v)}
            />
          </div>
          <p
            className={[
              'mt-1 text-[10.5px] leading-tight',
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

      {error ? <p className="text-[10.5px] leading-tight text-[var(--destructive)]">{error}</p> : null}
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-medium leading-tight transition',
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
  name,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  ariaLabel: string;
  name: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  const shown = focused ? draft : String(value);

  const commit = () => {
    setFocused(false);
    const clamped = parseIntInRange(draft, min, max);
    if (clamped === null) {
      setDraft(String(value));
      return;
    }
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <label className="flex flex-1 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-0.5">
      <span className="shrink-0 text-[10.5px] text-[var(--muted-foreground)]">{label}</span>
      <input
        type="number"
        name={name}
        autoComplete="off"
        className="no-spinner tnum w-full min-w-0 bg-transparent text-right text-[12.5px] font-semibold text-[var(--foreground)] outline-none"
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
