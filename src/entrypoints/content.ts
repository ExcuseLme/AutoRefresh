import type { ContentCommand, ContentEvent, SelectorProbe } from '@/lib/messages';
import { describeElement, simulateClick } from '@/lib/dom-click';
import { KEEP_ACTIVE_STORAGE_KEY } from '@/lib/keep-active';

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

    function activeElementIsInput(): boolean {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      return (el as HTMLElement).isContentEditable === true;
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

    let interactionEnabled = false;

    /**
     * 交互上报。对齐 ARP `script.js` 的 `wT` / `TT`：
     * - 必须 `e.isTrusted`：过滤我们自己的 AUTOCLICK 与第三方合成事件
     * - isInput 取 `document.activeElement`，不是 event.target
     */
    function onClickCapture(e: MouseEvent): void {
      if (!interactionEnabled) return;
      if (!e.isTrusted) return;
      if (isOurUi(e.target)) return;
      send({ type: 'INTERACTION', isInput: activeElementIsInput() });
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (!interactionEnabled) return;
      if (!e.isTrusted) return;
      if (isOurUi(e.target)) return;
      // ARP 忽略组合键：Ctrl/Alt/Meta 属于快捷键而非"使用页面"
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      send({ type: 'INTERACTION', isInput: activeElementIsInput() });
    }

    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('keydown', onKeyDown);

    /**
     * XHR 模式：模拟一次"真实点击"来触发页面自身的请求（ADR-009 / ADR-015）
     *
     * 实现细节见 `@/lib/dom-click`：必须派发完整的 pointer/mouse 序列，
     * 只调 `el.click()` 对 Gmail / 网易邮箱这类 SPA 无效（实测 0 请求）。
     */
    function autoClick(selector: string): 'ok' | 'not-found' | 'invalid' {
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
        simulateClick(el, window);
        return 'ok';
      } catch {
        return 'invalid';
      }
    }

    /** 探测选择器（面板「测试」按钮用）：不点击，只回报命中数与元素摘要 */
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
      return {
        result: 'ok',
        count: nodes.length,
        preview: describeElement(nodes[0]!),
      };
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
          sendResponse({ result: autoClick(msg.selector) });
          return false;
        }
        case 'TEST_SELECTOR': {
          sendResponse(probeSelector(msg.selector));
          return false;
        }
        case 'SET_INTERACTION': {
          interactionEnabled = msg.enabled;
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
