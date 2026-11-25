/**
 * 扩展版本号（ADR-029）
 *
 * 单一真源是 `package.json` 的 `version`，WXT 构建时自动写入 manifest，
 * 所以这里直接读运行中扩展的 manifest —— 显示的就是**浏览器里实际加载的那个版本**。
 *
 * 这正好满足用户的验证需求："每次改动后都要更新版本号，方便我观察扩展是否重载成功了"：
 * 重新加载扩展后面板显示的数字变了 ⇒ 新构建已生效；没变 ⇒ 还在跑旧产物。
 */
export function getExtensionVersion(): string {
  try {
    // chrome.runtime.getManifest() 在扩展页面里总是可用；非扩展环境（单测/happy-dom）会抛，走兜底
    const v = chrome?.runtime?.getManifest?.().version;
    return typeof v === 'string' && v.length > 0 ? v : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
