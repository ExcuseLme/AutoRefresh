import { useState } from 'react';

/** 通用分段控件（docs/04 §4.1 / §4.2）。视觉对齐 ARP：圆角外壳 + 选中项白底 */
export function SegmentedControl({
  value,
  items,
  onChange,
  ariaLabel,
}: {
  value: string;
  items: { value: string; label: string }[];
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-1 rounded-xl bg-[var(--secondary)] p-1"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={[
              'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
              active
                ? 'bg-[var(--card)] text-[var(--foreground)] shadow-sm'
                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            ].join(' ')}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** 居中大数字 + 自绘 −/+（docs/04 §4.1）。回车/失焦提交 */
export function NumberStepper({
  value,
  min,
  max,
  ariaLabel,
  onSubmit,
  autoFocus = false,
}: {
  value: number;
  min: number;
  max: number;
  ariaLabel: string;
  onSubmit: (v: number) => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : String(value);

  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onSubmit(clamped);
  };

  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onSubmit(next);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="decrease"
        onClick={() => step(-1)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--secondary)] text-[var(--secondary-foreground)] transition hover:border-[var(--primary)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M5 12h14" strokeLinecap="round" />
        </svg>
      </button>
      <input
        type="number"
        className="no-spinner tnum min-w-0 flex-1 bg-transparent text-center text-3xl font-bold text-[var(--foreground)] outline-none"
        aria-label={ariaLabel}
        value={shown}
        min={min}
        max={max}
        autoFocus={autoFocus}
        onFocus={() => {
          setFocused(true);
          setDraft(String(value));
        }}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          setFocused(false);
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <button
        type="button"
        aria-label="increase"
        onClick={() => step(1)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--secondary)] text-[var(--secondary-foreground)] transition hover:border-[var(--primary)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M5 12h14" strokeLinecap="round" />
          <path d="M12 5v14" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** 开关（role=switch，docs/04 §5） */
export function Switch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        disabled ? 'cursor-not-allowed opacity-50' : '',
        checked ? 'bg-[var(--primary)]' : 'bg-[var(--secondary-foreground)]/25',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all',
          checked ? 'left-4.5' : 'left-0.5',
        ].join(' ')}
      />
    </button>
  );
}

/** 下拉（重定向行为，docs/04 §4.3） */
export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value as T)}
        className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 pr-8 text-sm text-[var(--foreground)] outline-none transition hover:border-[var(--primary)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}

/** 选项卡片行：图标 + 标题/副标题 + 右侧控件，可展开子内容（docs/04 §4.3） */
export function SwitchRow({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center gap-3 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)] text-[var(--muted-foreground)]">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight text-[var(--foreground)]">{title}</p>
          <p className="mt-0.5 text-xs leading-tight text-[var(--muted-foreground)]">{description}</p>
        </div>
        <Switch checked={checked} onChange={onChange} ariaLabel={title} disabled={disabled} />
      </div>
      {children ? <div className="border-t border-[var(--border)] px-3 py-3">{children}</div> : null}
    </div>
  );
}
