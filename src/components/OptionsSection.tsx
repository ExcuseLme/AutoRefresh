import { useState } from 'react';
import { SegmentedControl, Select, SwitchRow } from './ui';

import { t } from '@/lib/i18n';
import type { Options, InteractionMode, Redirection } from '@/lib/options';
import { parseStrictInt } from '@/lib/number-input';

import { readOptionsCollapsed, writeOptionsCollapsed } from '@/lib/storage';

type PatchFn = (next: Partial<Options>) => Promise<{ ok: boolean; code?: string }>;

/**
 * 交互模式（ADR-032）：只有两档，正好对应用户的两种需求。
 */
const MODE_ITEMS: { value: InteractionMode; labelKey: string; descKey: string }[] = [
  { value: 'stable', labelKey: 'mode_stable', descKey: 'mode_desc_stable' },
  { value: 'hold-input', labelKey: 'mode_hold_input', descKey: 'mode_desc_hold_input' },
];

export function OptionsSection({ options, patch }: { options: Options; patch: PatchFn }) {
  const [collapsed, setCollapsed] = useState(readOptionsCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeOptionsCollapsed(next);
  };

  return (
    <section className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={t('aria_opt_section_toggle')}
        className="flex items-center gap-1.5 rounded px-0.5 py-0.5 text-left"
      >
        <span className="text-[var(--primary)] [&>svg]:h-3 [&>svg]:w-3">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </span>
        <span className="flex-1 text-[10.5px] font-medium text-[var(--muted-foreground)]">{t('opt_title')}</span>
        <span className="text-[var(--muted-foreground)]">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
          >
            <path d="m18 15-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {!collapsed ? (
        <>
          <SwitchRow
            icon={<BoltIcon />}
            title={t('opt_hard_refresh')}
            description={t('opt_desc_hard_refresh')}
            checked={options.hardRefresh}
            onChange={(v) => void patch({ hardRefresh: v })}
          />

          <SwitchRow
            icon={<FrameIcon />}
            title={t('opt_keep_active')}
            description={t('opt_desc_keep_active')}
            checked={options.keepActive}
            onChange={(v) => void patch({ keepActive: v })}
          />

          <SwitchRow
            icon={<HashIcon />}
            title={t('opt_refresh_limit')}
            description={t('opt_desc_refresh_limit')}
            checked={options.refreshLimitEnabled}
            onChange={(v) => void patch({ refreshLimitEnabled: v })}
          >
            {options.refreshLimitEnabled ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] text-[var(--muted-foreground)]">{t('opt_refresh_limit_count')}</span>
                <IntField
                  value={options.refreshLimitCount}
                  min={1}
                  ariaLabel={t('aria_refresh_limit_count')}
                  name="refreshLimitCount"
                  onCommit={(v) => void patch({ refreshLimitCount: v })}
                />
              </div>
            ) : null}
          </SwitchRow>
          {/*
           * 交互模式（ADR-032）：改成二选一，不再是「开关 + 三选一动作 + 触发范围」三层。
           * 用户明确只有两种需求：
           *   stable      无视输入框状态，倒计时始终稳定
           *   hold-input  输入框占用（有焦点或有内容）时持续暂停，解除后自动恢复
           */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5">
            <div className="mb-1 flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--secondary)] text-[var(--muted-foreground)] [&>svg]:h-3 [&>svg]:w-3">
                <HandIcon />
              </span>
              <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--foreground)]">
                {t('opt_interactions')}
              </p>
            </div>
            <SegmentedControl
              value={options.interactionMode}
              items={MODE_ITEMS.map((m) => ({ value: m.value, label: t(m.labelKey) }))}
              onChange={(v) => void patch({ interactionMode: v as InteractionMode })}
              ariaLabel={t('opt_interactions')}
            />
            <p className="mt-1 text-[10px] leading-tight text-[var(--muted-foreground)]">
              {t(MODE_ITEMS.find((m) => m.value === options.interactionMode)?.descKey ?? 'mode_desc_stable')}
            </p>
          </div>

          {/* 重定向：标题行 + 下拉 + 说明压成两行（原来占三行 + 大内边距） */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--secondary)] text-[var(--muted-foreground)] [&>svg]:h-3 [&>svg]:w-3">
                <CompassIcon />
              </span>
              <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--foreground)]">
                {t('opt_redirection')}
                <span className="ml-1.5 text-[10.5px] font-normal text-[var(--muted-foreground)]">
                  {t('opt_desc_redirection')}
                </span>
              </p>
              <div className="w-[132px] shrink-0">
                <Select<Redirection>
                  value={options.redirection}
                  ariaLabel={t('opt_redirection')}
                  name="redirection"
                  onChange={(v) => void patch({ redirection: v })}
                  options={[
                    { value: 'follow', label: t('redirect_follow') },
                    { value: 'canonical', label: t('redirect_canonical') },
                  ]}
                />
              </div>
            </div>
            <p className="mt-0.5 truncate text-[10.5px] leading-tight text-[var(--muted-foreground)]">
              {t(options.redirection === 'canonical' ? 'redirect_canonical_desc' : 'redirect_follow_desc')}
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}


/** 小号整数输入（次数 / 等待秒数） */
function IntField({
  value,
  min,
  ariaLabel,
  name,
  onCommit,
}: {
  value: number;
  min: number;
  ariaLabel: string;
  name: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  const commit = () => {
    setFocused(false);
    const parsed = parseStrictInt(draft);
    if (parsed === null || parsed < min) {
      setDraft(String(value));
      return;
    }
    setDraft(String(parsed));
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <input
      type="number"
      name={name}
      autoComplete="off"
      aria-label={ariaLabel}
      className="no-spinner tnum w-14 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-1.5 py-0.5 text-right text-[12px] font-semibold text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
      value={focused ? draft : String(value)}
      min={min}
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
  );
}

// ── 图标

function BoltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
    </svg>
  );
}

function HashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" strokeLinecap="round" />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8 8 8 0 0 1 1.58-4.8" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z" />
    </svg>
  );
}
