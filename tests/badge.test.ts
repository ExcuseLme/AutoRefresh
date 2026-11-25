import { describe, expect, it } from 'vitest';
import { badgeAppearance, BADGE_COLORS, countdownText } from '@/lib/badge';
import { createSession } from '@/lib/session';

describe('countdownText（ADR-031：>=60s 显示截断分钟数）', () => {
  it('小于 60 秒显示秒数本身', () => {
    expect(countdownText(59_000)).toBe('59');
    expect(countdownText(10_000)).toBe('10');
    expect(countdownText(1_000)).toBe('1');
  });

  it('60 秒整显示 1m', () => {
    expect(countdownText(60_000)).toBe('1m');
  });

  it('60~119 秒都显示 1m（截断，不四舍五入）', () => {
    expect(countdownText(61_000)).toBe('1m');
    expect(countdownText(90_000)).toBe('1m');
    expect(countdownText(119_000)).toBe('1m');
  });

  it('120~179 秒都显示 2m', () => {
    expect(countdownText(120_000)).toBe('2m');
    expect(countdownText(179_000)).toBe('2m');
  });

  it('300 秒显示 5m（截断而非四舍五入）', () => {
    expect(countdownText(300_000)).toBe('5m');
    // 240–299 秒全部是 4m，只有到 300 才跳到 5m ⇒ 证明用的是 floor
    expect(countdownText(240_000)).toBe('4m');
    expect(countdownText(299_000)).toBe('4m');
    expect(countdownText(300_000)).toBe('5m');
  });

  it('不足 1 秒用向上取整，避免"显示 0 但还没刷新"', () => {
    expect(countdownText(200)).toBe('1');
    expect(countdownText(0)).toBe('0');
    expect(countdownText(-500)).toBe('0');
  });

  it('大数值按分钟截断（1 小时 = 60m）', () => {
    expect(countdownText(3_600_000)).toBe('60m');
    expect(countdownText(86_400_000)).toBe('1440m');
  });
});

describe('badgeAppearance（徽章按会话状态切换）', () => {
  const now = 1_700_000_000_000;

  it('没有会话 ⇒ 面板图标正常显示，不显示倒计时', () => {
    expect(badgeAppearance(null, now)).toEqual({ text: '', color: BADGE_COLORS.running });
  });

  it('运行中 ⇒ 显示倒计时秒数', () => {
    const s = createSession(1, 'https://example.com/', 10_000, 'tok');
    s.armedAt = now;
    s.delayMs = 10_000;
    expect(badgeAppearance(s, now)).toEqual({ text: '10', color: BADGE_COLORS.running });

    // 过了 4 秒 ⇒ 剩 6 秒
    expect(badgeAppearance(s, now + 4_000).text).toBe('6');
  });

  it('运行中且间隔 >= 60s ⇒ 显示分钟', () => {
    const s = createSession(1, 'https://example.com/', 120_000, 'tok');
    s.armedAt = now;
    s.delayMs = 120_000;
    expect(badgeAppearance(s, now).text).toBe('2m');
    // 剩 61 秒时仍是 1m
    expect(badgeAppearance(s, now + 59_000).text).toBe('1m');
  });

  it('暂停 ⇒ II 黄，不显示倒计时', () => {
    const s = createSession(1, 'https://example.com/', 10_000, 'tok');
    s.status = 'pause';
    expect(badgeAppearance(s, now)).toEqual({ text: 'II', color: BADGE_COLORS.paused });
  });

  it('失败 ⇒ ! 红（优先于倒计时）', () => {
    const s = createSession(1, 'https://example.com/', 10_000, 'tok');
    s.lastError = 'xhr_not_found';
    expect(badgeAppearance(s, now)).toEqual({ text: '!', color: BADGE_COLORS.failed });
  });

  it('等待重启（wait）⇒ 仍显示倒计时', () => {
    const s = createSession(1, 'https://example.com/', 5_000, 'tok');
    s.status = 'wait';
    s.armedAt = now;
    s.delayMs = 5_000;
    expect(badgeAppearance(s, now).text).toBe('5');
  });

  it('到期后不出现负数', () => {
    const s = createSession(1, 'https://example.com/', 10_000, 'tok');
    s.armedAt = now;
    expect(badgeAppearance(s, now + 20_000).text).toBe('0');
  });
});
