import { useState } from 'react';
import { parseIntInRange } from '@/lib/number-input';

/**
 * 紧凑版 UI 原子组件（docs/04 §4 / ADR-023）
 *
 * 设计基准（全部比 ARP 继承版小一档，但不牺牲可点面积）：
 *   分段控件  py-1 / 11px 文字 / 圆角 lg
 *   数字输入  按钮 h-7 w-7，数字 20px
 *   开关      18×32
 *   选项行    py-1.5，图标 14px
 */

/** 通用分段控件。视觉对齐 ARP：圆角外壳 + 选中项白底 */
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
    <div role="tablist" aria-label={ariaLabel} className="flex gap-0.5 rounded-lg bg-[var(--secondary)] p-0.5">
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
              'flex-1 rounded-md px-2 py-1 text-[11px] font-medium leading-tight transition',
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

/** 踏步输入：居中数字 + 自绘 −/+。回车/失焦提交 */
export function NumberStepper({
  value,
  min,
  max,
  ariaLabel,
  name,
  onSubmit,
  autoFocus = false,
  decreaseLabel = 'decrease',
  increaseLabel = 'increase',
}: {
  value: number;
  min: number;
  max: number;
  ariaLabel: string;
  name: string;
  onSubmit: (v: number) => void;
  autoFocus?: boolean;
  decreaseLabel?: string;
  increaseLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : String(value);

  const commit = (raw: string) => {
    const clamped = parseIntInRange(raw, min, max);
    if (clamped === null) {
      setDraft(String(value));
      return;
    }
    setDraft(String(clamped));
    if (clamped !== value) onSubmit(clamped);
  };

  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onSubmit(next);
  };

  return (
    <div className="flex items-center gap-1.5">
      <StepButton label={decreaseLabel} onClick={() => step(-1)} minus />
      <input
        type="number"
        name={name}
        autoComplete="off"
        className="no-spinner tnum min-w-0 flex-1 bg-transparent text-center text-xl font-bold leading-none text-[var(--foreground)] outline-none"
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
      <StepButton label={increaseLabel} onClick={() => step(1)} />
    </div>
  );
}

function StepButton({ label, onClick, minus = false }: { label: string; onClick: () => void; minus?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--secondary)] text-[var(--secondary-foreground)] transition hover:border-[var(--primary)]"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        {minus ? (
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

/** 开关（role=switch） */
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
        'relative h-[18px] w-8 shrink-0 rounded-full transition-colors',
        disabled ? 'cursor-not-allowed opacity-50' : '',
        checked ? 'bg-[var(--primary)]' : 'bg-[var(--secondary-foreground)]/25',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all',
          checked ? 'left-[15px]' : 'left-0.5',
        ].join(' ')}
      />
    </button>
  );
}

/** 下拉（重定向行为） */
export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  name,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
  name: string;
}) {
  return (
    <div className="relative">
      <select
        name={name}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value as T)}
        className="w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 pr-6 text-[11px] leading-tight text-[var(--foreground)] outline-none transition hover:border-[var(--primary)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}

/** 选项行：图标 + 标题/副标题 + 右侧控件，可展开子内容 */
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
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--secondary)] text-[var(--muted-foreground)] [&>svg]:h-3 [&>svg]:w-3">
          {icon}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[12px] font-medium text-[var(--foreground)]">{title}</p>
          <p className="truncate text-[10.5px] text-[var(--muted-foreground)]">{description}</p>
        </div>
        <Switch checked={checked} onChange={onChange} ariaLabel={title} disabled={disabled} />
      </div>
      {children ? <div className="border-t border-[var(--border)] px-2.5 py-1.5">{children}</div> : null}
    </div>
  );
}
