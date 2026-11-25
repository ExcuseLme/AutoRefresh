import type { ClickAction } from '@/lib/options';
import type { ContentCommand, ContentEvent, SelectorProbe } from '@/lib/messages';
import { describeElement, simulateClick } from '@/lib/dom-click';
import { startPicker, stopPicker } from '@/lib/picker';
import { highlightElement } from '@/lib/highlight';
import { KEEP_ACTIVE_STORAGE_KEY } from '@/lib/keep-active';
import { computeInputHold } from '@/lib/input-hold';

/**
 * 内容脚本（ISOLATED world）。职责仅三件（docs/05 §5、§6.2、§7）：
 * 1. 交互上报 —— click（捕获阶段）与 keydown，带 isTrusted 与 activeElement 判定
 * 2. XHR 模式的自动点击（AUTOCLICK）
 * 3. keep-active 的 sessionStorage TTL 自愈（页面重载后重新打 MAIN world 补丁）
 *
 * 不做：页面扫描、关键词、DOM diff（那些属于已丢弃的监控功能）。
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: false,
  main() {
    const ourUiSelector = '.arp-ui-root, #arp-ui-root, arp-div, arp-content-div';

    function isOurUi(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) return false;
      return Boolean(target.closest(ourUiSelector));
    }

    function send(msg: ContentEvent): void {
      try {
        void chrome.runtime.sendMessage(msg).catch(() => {
          /* SW 未就绪/已回收时忽略 */
        });
      } catch {
        /* 扩展被卸载后 chrome.runtime 不可用，忽略 */
      }
    }

    /**
     * 输入框占用监视（ADR-032）。
     *
     * 这是**状态**而不是事件：用户要的是"输入框被占用的整段时间都不刷新"，
     * 而不是"每次点击/按键打断一次"。旧实现按事件上报，语义与需求不符，已废弃。
     *
     * 三条腿保证状态不丢：
     *   1. `focusin` / `focusout` —— 光标进出输入框（覆盖 Tab、程序化 focus）
     *   2. `input` / `change` —— 内容变化（覆盖粘贴、脚本赋值、自动填充）
     *   3. **兜底轮询**（1s）—— 覆盖不上报上述事件的场景（如脚本直接改 `value`）
     *
     * 只在状态**变化**时上报，避免每秒都把 SW 与 offscreen 打一遍。
     */
    let inputHoldEnabled = false;
    let lastHeld = false;
    let holdPollTimer = 0;

    function reportInputHold(force = false): void {
      const held = computeInputHold(document);
      if (!force && held === lastHeld) return;
      lastHeld = held;
      send({ type: 'INPUT_HOLD', held });
    }

    /** 事件到达后按微任务重算（此时 DOM 的 value / activeElement 已更新） */
    function onHoldSignal(): void {
      if (!inputHoldEnabled) return;
      Promise.resolve().then(() => {
        if (inputHoldEnabled) reportInputHold();
      });
    }

    function startInputHoldMonitor(): void {
      if (holdPollTimer) return;
      document.addEventListener('focusin', onHoldSignal, true);
      document.addEventListener('focusout', onHoldSignal, true);
      document.addEventListener('input', onHoldSignal, true);
      document.addEventListener('change', onHoldSignal, true);
      // 兜底轮询：有些页面用脚本改 value 而不派发 input 事件
      holdPollTimer = window.setInterval(() => reportInputHold(), 1000);
      reportInputHold(true);
    }

    function stopInputHoldMonitor(): void {
      document.removeEventListener('focusin', onHoldSignal, true);
      document.removeEventListener('focusout', onHoldSignal, true);
      document.removeEventListener('input', onHoldSignal, true);
      document.removeEventListener('change', onHoldSignal, true);
      if (holdPollTimer) {
        clearInterval(holdPollTimer);
        holdPollTimer = 0;
      }
      lastHeld = false;
    }

    /**
     * XHR 模式：模拟一次"真实点击"来触发页面自身的请求（ADR-009 / ADR-015 / ADR-020）
     *
     * 实现细节见 `@/lib/dom-click`：必须派发完整的 pointer/mouse 序列，
     * 只调 `el.click()` 对 Gmail / 网易邮箱这类 SPA 无效（实测 0 请求）。
     */
    function autoClick(selector: string, action: ClickAction = 'single'): 'ok' | 'not-found' | 'invalid' {
      const trimmed = selector.trim();
      if (!trimmed) return 'not-found';
      let el: Element | null = null;
      try {
        el = document.querySelector(trimmed);
      } catch {
        return 'invalid';
      }
      if (!el) return 'not-found';
      try {
        simulateClick(el, { action, view: window });
        return 'ok';
      } catch {
        return 'invalid';
      }
    }

    /**
     * 探测选择器（面板「测试选择器」按钮用）：不点击，只回报命中数与元素摘要。
     *
     * ADR-031：命中时把目标元素滚动到可见区并做一次呼吸高亮，
     * 让用户确认自己选中的到底是哪个元素。只对**第一个**命中元素做 ——
     * 选择器可能命中多个，页面上的"典型目标"就是第一个。
     */
    function probeSelector(selector: string): SelectorProbe {
      const trimmed = selector.trim();
      if (!trimmed) return { result: 'not-found', count: 0 };
      let nodes: Element[];
      try {
        nodes = [...document.querySelectorAll(trimmed)];
      } catch {
        return { result: 'invalid' };
      }
      if (nodes.length === 0) return { result: 'not-found', count: 0 };

      const first = nodes[0]!;
      const preview = describeElement(first);
      try {
        highlightElement(first, nodes.length > 1 ? `${nodes.length} 个命中（第 1 个）` : preview);
      } catch {
        /* 高亮失败不影响探测结果 */
      }

      return { result: 'ok', count: nodes.length, preview };
    }

    /**
     * keep-active 自愈：页面重载/路由变化后若 TTL 未过期，通知 SW 重新注入 MAIN world 补丁。
     * ISOLATED world 不能直接改页面原型，所以补丁始终由 SW 用 scripting.executeScript 注入。
     */
    function renewKeepActive(): void {
      try {
        const raw = sessionStorage.getItem(KEEP_ACTIVE_STORAGE_KEY);
        if (!raw) return;
        const expiresAt = Number(raw);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
        send({ type: 'CONTENT_READY' });
      } catch {
        /* 忽略 */
      }
    }

    chrome.runtime.onMessage.addListener((msg: ContentCommand, _sender, sendResponse) => {
      switch (msg?.type) {
        case 'AUTOCLICK': {
          sendResponse({ result: autoClick(msg.selector, msg.action) });
          return false;
        }
        case 'TEST_SELECTOR': {
          sendResponse(probeSelector(msg.selector));
          return false;
        }
        case 'PICKER_START': {
          // 拾取器回调走 runtime.sendMessage 回 SW（不能走 sendResponse，
          // 因为用户点选是异步的，远超 sendResponse 的同步窗口）
          const ok = startPicker({
            onPick: (selector, preview) => {
              send({ type: 'PICKER_RESULT', selector, preview });
            },
            onCancel: (reason) => {
              send({ type: 'PICKER_CANCELLED', reason });
            },
          });
          sendResponse({ ok });
          return false;
        }
        case 'PICKER_STOP': {
          stopPicker();
          sendResponse({ ok: true });
          return false;
        }
        case 'SET_INPUT_HOLD': {
          inputHoldEnabled = msg.enabled;
          if (inputHoldEnabled) startInputHoldMonitor();
          else stopInputHoldMonitor();
          sendResponse({ ok: true });
          return false;
        }
        case 'CLEAR_KEEP_ACTIVE': {
          try {
            sessionStorage.removeItem(KEEP_ACTIVE_STORAGE_KEY);
          } catch {
            /* 忽略 */
          }
          sendResponse({ ok: true });
          return false;
        }
        default:
          return false;
      }
    });

    renewKeepActive();
    send({ type: 'CONTENT_READY' });
  },
});
