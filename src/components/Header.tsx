import { useState } from 'react';
import { t } from '@/lib/i18n';
import type { Options } from '@/lib/options';
import type { Session } from '@/lib/session';
import { summarize } from '@/lib/session-machine';

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
  const running = session !== null && (session.status === 'start' || session.status === 'wait');
  const paused = session?.status === 'pause';

  const onPrimary = async () => {
    setError(null);
    if (running) {
      await control.stop();
      return;
    }
    if (paused) {
      await control.resume();
      return;
    }
    const code = await control.start();
    if (code) setError(t(code));
  };

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)]">
            <RefreshIcon />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-[var(--foreground)]">{t('app_name')}</p>
            <p className="truncate text-[11px] text-[var(--muted-foreground)]">{statusLine(session, options)}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {paused ? (
            <button
              type="button"
              onClick={() => void control.stop()}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--secondary)]"
            >
              {t('action_stop')}
            </button>
          ) : null}
          {running ? (
            <button
              type="button"
              onClick={() => void control.pause()}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition hover:bg-[var(--secondary)]"
            >
              {t('action_pause')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void onPrimary()}
            className={[
              'flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition',
              running ? 'bg-[var(--destructive)] hover:opacity-90' : 'bg-[var(--primary)] hover:bg-[var(--primary-hover)]',
            ].join(' ')}
          >
            {running ? <StopIcon /> : <PlayIcon />}
            {running ? t('action_stop') : paused ? t('action_resume') : t('action_start')}
          </button>
        </div>
      </div>
      {error ? (
        <p className="px-4 pb-2 text-[11px] leading-tight text-[var(--destructive)]">{error}</p>
      ) : null}
      {session?.lastError ? (
        <p className="px-4 pb-2 text-[11px] leading-tight text-[var(--destructive)]">
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

