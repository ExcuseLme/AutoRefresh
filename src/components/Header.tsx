import { useState } from 'react';
import { t } from '@/lib/i18n';
import type { Options } from '@/lib/options';
import type { Session } from '@/lib/session';
import { summarize } from '@/lib/session-machine';
import { getExtensionVersion } from '@/lib/version';

type Control = {
  start: () => Promise<string | null>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
};

function statusLine(session: Session | null, options: Options): string {
  const s = summarize(session, options.refreshLimitEnabled ? options.refreshLimitCount : null);
  switch (s.kind) {
    case 'running': {
      // OQ-2：头部显示"N 秒后刷新"，配合 count 显示进度
      const remain = session ? Math.max(0, Math.ceil((session.armedAt + session.delayMs - Date.now()) / 1000)) : 0;
      const count =
        s.limit === null
          ? t('status_count', [s.count])
          : t('status_count_limited', [s.count, s.limit]);
      return `${t('status_next_in', [remain])} · ${count}`;
    }
    case 'paused':
      return `${t('status_paused')} · ${t('status_count', [s.count])}`;
    case 'waiting':
      return t('status_waiting_restart', [s.seconds]);
    default:
      return t('status_idle');
  }
}

/** 失败告警文案（docs/05 §7.2）：明确说是"本轮未生效"，避免"计数在涨但其实没点"的误解 */
function failureText(session: Session): string {
  const n = session.failedRounds ?? 0;
  const base = t(session.lastError ?? 'xhr_not_found');
  return n > 1 ? `${base} ${t('status_failed_times', [n])}` : base;
}

/**
 * 头部（ADR-028 重新设计按钮语义）
 *
 * 两个按钮位置固定、职责固定，不再随状态互换左右：
 *   左侧：**只在运行中出现**，内容为「暂停」/「继续」
 *   右侧：始终存在，内容为「开始」/「停止」
 *
 * | 状态 | 左侧 | 右侧 |
 * | --- | --- | --- |
 * | 未运行 | （无） | 开始 |
 * | 运行中 | 暂停 | 停止 |
 * | 已暂停 | 继续 | 停止 |
 */
export function Header({
  session,
  options,
  control,
}: {
  session: Session | null;
  options: Options;
  control: Control;
}) {
  const [error, setError] = useState<string | null>(null);

  /** 右侧主按钮：未运行 ⇒ 开始；运行中或已暂停 ⇒ 停止（永远是"停止"，不变成"继续"） */
  const active = session !== null;
  const paused = session?.status === 'pause';

  const onPrimary = async () => {
    setError(null);
    if (active) {
      await control.stop();
      return;
    }
    const code = await control.start();
    if (code) setError(t(code));
  };

  /** 左侧副按钮：只在运行中/已暂停时出现 */
  const onSecondary = async () => {
    setError(null);
    if (paused) await control.resume();
    else await control.pause();
  };

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] [&>svg]:h-3.5 [&>svg]:w-3.5">
          <RefreshIcon />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="flex items-baseline gap-1.5 text-[12.5px] font-semibold text-[var(--foreground)]">
            <span className="truncate">{t('app_name')}</span>
            {/* ADR-029：显示运行中扩展的 manifest 版本，用来判断是否重载成功 */}
            <span className="shrink-0 font-mono text-[9.5px] font-normal text-[var(--muted-foreground)]">
              v{getExtensionVersion()}
            </span>
          </p>
          <p className="truncate text-[10.5px] text-[var(--muted-foreground)]">{statusLine(session, options)}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* 左侧副按钮：暂停 / 继续（只在会话存在时渲染，位置永远在左） */}
          {active ? (
            <button
              type="button"
              onClick={() => void onSecondary()}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium leading-tight text-[var(--muted-foreground)] transition hover:bg-[var(--secondary)]"
            >
              {paused ? t('action_resume') : t('action_pause')}
            </button>
          ) : null}

          {/* 右侧主按钮：开始 / 停止（永远在右，内容只会是这两个之一） */}
          <button
            type="button"
            onClick={() => void onPrimary()}
            className={[
              'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold leading-tight text-white transition',
              active ? 'bg-[var(--destructive)] hover:opacity-90' : 'bg-[var(--primary)] hover:bg-[var(--primary-hover)]',
            ].join(' ')}
          >
            {active ? <StopIcon /> : <PlayIcon />}
            {active ? t('action_stop') : t('action_start')}
          </button>
        </div>
      </div>
      {error ? (
        <p className="px-2.5 pb-1.5 text-[10.5px] leading-tight text-[var(--destructive)]">{error}</p>
      ) : null}
      {session?.lastError ? (
        <p className="px-2.5 pb-1.5 text-[10.5px] leading-tight text-[var(--destructive)]">
          {failureText(session)}
        </p>
      ) : null}
    </header>
  );
}

// ── 图标（内联 SVG，避免引入图标库）

function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 12a9 9 0 0 1-15.5 6.3M3 12a9 9 0 0 1 15.5-6.3" strokeLinecap="round" />
      <path d="M21 3v6h-6M3 21v-6h6" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}
