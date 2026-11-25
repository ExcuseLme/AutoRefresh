import { useState } from 'react';
import { SegmentedControl, Select, SwitchRow } from './ui';

import { t } from '@/lib/i18n';
import { triggerScope, type TriggerScope, scopePatch } from '@/lib/interaction';
import { parseStrictInt } from '@/lib/number-input';
import type { InteractionAction, Options, Redirection } from '@/lib/options';
import { readOptionsCollapsed, writeOptionsCollapsed } from '@/lib/storage';

type PatchFn = (next: Partial<Options>) => Promise<{ ok: boolean; code?: string }>;

/** 触发范围三档（ADR-028）。互斥由枚举本身保证，不存在"两个都开"的非法态 */
const SCOPE_ITEMS: { value: TriggerScope; labelKey: string; descKey: string }[] = [
  { value: 'all', labelKey: 'scope_opt_all', descKey: 'scope_all' },
  { value: 'outside-input', labelKey: 'scope_opt_outside', descKey: 'scope_outside_input' },
  { value: 'inside-input-only', labelKey: 'scope_opt_inside', descKey: 'scope_inside_input_only' },
];

const ACTIONS: { value: InteractionAction; labelKey: string; danger?: boolean }[] = [
  { value: 'stop', labelKey: 'act_stop', danger: true },
  { value: 'pause', labelKey: 'act_pause' },
  { value: 'restart', labelKey: 'act_restart' },
];

export function OptionsSection({ options, patch }: { options: Options; patch: PatchFn }) {
  const [collapsed, setCollapsed] = useState(readOptionsCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeOptionsCollapsed(next);
  };

  const scope = triggerScope(options);

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
           * ADR-027：把两个触发范围子选项收进「用户交互时的刷新行为」的卡片内，
           * 视觉上与父项连成一组（同一张卡片 + 左侧竖线表示从属），
           * 不再是平级的两个独立卡片。
           */}
          <SwitchRow
            icon={<HandIcon />}
            title={t('opt_interactions')}
            description={t('opt_desc_interactions')}
            checked={options.interactions}
            onChange={(v) => void patch({ interactions: v })}
          >
            {options.interactions ? (
              <div className="flex flex-col gap-1">
                {/* 动作三选一 */}
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('opt_interactions')}>
                  {ACTIONS.map((a) => {
                    const active = options.interactionAction === a.value;
                    return (
                      <button
                        key={a.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => void patch({ interactionAction: a.value })}
                        className={[
                          'rounded border px-2 py-0.5 text-[10.5px] font-medium leading-tight transition',
                          active && a.danger
                            ? 'border-rose-300 bg-rose-50 text-rose-600'
                            : active
                              ? 'border-[var(--accent-border)] bg-[var(--accent)] text-[var(--accent-foreground)]'
                              : 'border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)]',
                        ].join(' ')}
                      >
                        {t(a.labelKey)}
                      </button>
                    );
                  })}
                </div>

                {options.interactionAction === 'restart' ? (
                  /* ADR-026：固定档直接用当前刷新间隔，不提供输入框；
                     只有随机档（没有"当前间隔"这个单一数值）才给自定义输入 */
                  options.intervalMode === 'fixed' ? (
                    <p className="text-[10.5px] leading-tight text-[var(--muted-foreground)]">
                      {t('act_restart_wait_fixed', [options.fixedSeconds])}
                    </p>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10.5px] text-[var(--muted-foreground)]">{t('act_restart_wait')}</span>
                      <div className="flex items-center gap-1">
                        <IntField
                          value={options.interactionRestartWait}
                          min={0}
                          ariaLabel={t('aria_restart_wait')}
                          name="interactionRestartWait"
                          onCommit={(v) => void patch({ interactionRestartWait: v })}
                        />
                        <span className="text-[10.5px] text-[var(--muted-foreground)]">{t('act_restart_wait_unit')}</span>
                      </div>
                    </div>
                  )
                ) : null}

                {/*
                 * 触发范围（ADR-028）：三段互斥，用 SegmentedControl 而不是两个开关。
                 *
                 * 为什么不用两个开关：2 个布尔 = 4 种组合，但只有 3 种合法（两端/仅框外/仅框内），
                 * `{inputOnly:true, ignoreInputField:true}` 那个组合是冗余非法态。
                 * 无论怎么调互斥规则都只是在掩盖它（优先级 / 强制关另一个 / 置灰），
                 * 用一个三档枚举就天然互斥、没有非法态、也不需要"记住上一档"。
                 *
                 * 映射到已有字段（不改 schema）：
                 *   all    → { interactionInputOnly: false, ignoreInputField: false }
                 *   outside→ { interactionInputOnly: false, ignoreInputField: true }
                 *   inside → { interactionInputOnly: true }（ignoreInputField 不参与判定）
                 */}
                <div className="ml-1 flex flex-col gap-1 border-l-2 border-[var(--border)] pl-2">
                  <p className="text-[10px] font-medium leading-tight text-[var(--muted-foreground)]">
                    {t('opt_trigger_scope')}
                  </p>
                  <SegmentedControl
                    value={scope}
                    items={SCOPE_ITEMS.map((s) => ({ value: s.value, label: t(s.labelKey) }))}
                    onChange={(v) => void patch(scopePatch(v as TriggerScope))}
                    ariaLabel={t('opt_trigger_scope')}
                  />
                  <p className="text-[10px] leading-tight text-[var(--muted-foreground)]">
                    {t(SCOPE_ITEMS.find((s) => s.value === scope)?.descKey ?? 'scope_all')}
                  </p>
                </div>
              </div>
            ) : null}
          </SwitchRow>

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
