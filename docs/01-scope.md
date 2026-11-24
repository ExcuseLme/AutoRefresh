# 01 · 功能范围（保留 / 丢弃 / 边界）

> 判定原则：**只做用户点名要的**。任何 ARP 有、但用户没点的东西，一律不写进代码；
> 若某项虽未被点名但会显著影响"刷新能不能正常跑完"，放进 `08` 的 Open Questions 等用户拍板，不擅自加。

## A. 保留的常规功能（7 项）

| # | 用户表述 | ARP 内部键 | ARP 行为（证据） | 本扩展目标行为 |
| --- | --- | --- | --- | --- |
| A1 | 强制刷新 | `hardRefresh`（域级 `hardRefresh` / 全局 `hardRefresh`） | 刷新时 `tabs.reload(tabId, {bypassCache:true})`（`background.js` 中 `lx`→`l()` 分支） | 开：`tabs.reload({bypassCache:true})`；关：普通 reload |
| A2 | 让页面在后台保持活动 | `keepActive`（域级；ARP 标记为 premium） | 启动刷新时 `ib(tab)` 以 `world:"MAIN"` 注入 `Qy()`：劫持 `Document.prototype.visibilityState/hidden/hasFocus`、吞掉 `visibilitychange/webkitvisibilitychange/freeze`、并每 45s 派发一次 `mousemove/pointermove`；同时写入 `sessionStorage.__arp_keep_active`（60s TTL）供 `keep-active.js` 在 `document_start` 自愈 | 同机制，**去掉 premium 门禁**；每次刷新重新续期 TTL |
| A3 | 设置刷新次数 | `refreshNumber`(bool) + `setRefNumber`(N) | 每轮结束后 `count = count + 1`；`export async function Zw` 中 `if(o && l>0 && c>l) return $b(tab)`（停止刷新） | 开：N 次后自动停止；关：无限。`count` 属于会话态，重启扩展/重新开始时归零 |
| A4 | 用户交互时的刷新行为 | `interactions`(bool) + `interactionAction`(`pause`/`stop`/`restart`) + `interactionRestartWait`(秒) | 内容脚本 `script.js` 注册 `document` 级 `click`(捕获)、`keydown`，向后台发 `interaction` 消息；后台 `xN`：若 `interactions` 关 或（`isInput` 且 `ignoreInputField` 开）则忽略；否则按 `interactionAction` 执行 `mS(pause)` / `$b(stop)` / `pS(restart, wait)` | 保留三选一；`restart` 额外支持"延迟 N 秒后重启"(ARP 的 `interactionRestartWait`，UI 里有 `restart_wait_seconds_desc`） |
| A5 | 重定向行为 | `redirectionBehavior`：`follow`(跟随所有重定向) / `canonical`(跟随规范 URL)；旧的全局键 `urlChangeFollow`(0=canonical) | `dx()`：`d = canonical ? CANONICAL_URL : follow`；`lx()` 中若目标 URL 与当前 tab URL 不同，先 `tabs.update(url)` 再可选 reload；`canonical` 时取 `session.canonicalUrl`（开始刷新那一刻的 URL） | 两档下拉，语义保持一致：`follow`=跟随页面重定向到的 URL 继续刷新；`canonical`=始终回到开始时的 URL |
| A6 | 忽略输入框交互 | `ignoreInputField`（默认 **true**） | 内容脚本点击/按键上报时携带 `isInput: activeElement 是 INPUT/TEXTAREA`；后台 `xN` 中 `t?.isInput && options.ignoreInputField` ⇒ 直接 return | 同语义：开=在输入框里点/打字不触发交互行为；关=输入框里的操作也算交互 |
| A7 | 用户交互时的更新行为 | 与 A4 **同一个** `interactions` 开关（ARP 在独立设置页 `account.autorefresh.io/time-interval` 用另一个标题重复暴露，见 `assets/reference/settings-page-*.png` 与该页 uid 5_88 文案） | 见 A4 | 与 A4 合并为一个开关 + 行为分段控件（**OQ-1 待确认是否真的要拆成两个独立开关**） |

> A4/A7 的识别依据：设置页 `time-interval` 的标题文案为「用户交互时的更新行为」，描述为
> "当您与页面交互（鼠标点击或键盘）时，Auto Refresh Plus 可以暂停、停止或重新启动倒计时…"，
> 与 popup `间隔` tab 的「用户交互时的刷新行为」是同一功能的两处入口，底层同写 `options.interactions`。

## B. 保留的间隔能力

| # | 要求 | ARP 现状（证据） | 本扩展目标 |
| --- | --- | --- | --- |
| B1 | 固定间隔档位改为 `3s / 5s / 10s / 60s` | `a5` 数组：5s、10s、15s、60s(`custom-60`)、5m、10m、15m，另有一个带铅笔的"自定义秒"chip | 只保留 4 个预设 chip：3s、5s、10s、60s |
| B2 | 自定义档位可输入任意 >0 数值 | 固定档内的自定义 chip 写 `time_type='custom'` + `custom_interval`(秒)；另有独立的「自定义」模式 tab 实为 `time_type='timer'`（时/分/秒） | **只保留一套自定义**：秒为单位、`>0`、允许小数；`custom_interval` 存**全局**（ARP 存域级 + 用 `localStorage.time_type` 记录上次模式，二者丢弃） |
| B3 | 自定义值全局同步 | ARP：每个 URL/域各存一份 `custom_interval` | 单一全局字段；任何页面读同一值 |
| B4 | 随机间隔：min/max 均包含，每轮重新随机 | `qg()`：整数时 `i = max-min+1; floor(random()*i)+min` ⇒ 整数秒闭区间；另有 `$_()` 保证"新一轮不要和上一轮相同"（最多重试 10 次） | 闭区间 `[min,max]`，整数秒；`min===max` 时退化为固定；**保留** ARP 的"避免连续两轮相同"（可选开关化，见 ADR-006） |
| B5 | 随机范围的合法性 | UI 里 max 的 `valuemin` 跟随 min（快照 `uid=2_4 valuemin=6`） | min ≥1；max ≥ min；非法输入内联报错且不落库 |

## C. 保留的刷新类型（从「监控」tab 搬到「间隔」tab）

| # | 要求 | ARP 证据 | 本扩展目标 |
| --- | --- | --- | --- |
| C1 | 完整页面刷新 | `pmOptions.refresh = '1'`（`FULL`） | 走完整刷新流水线（reload / update+reload） |
| C2 | XHR 刷新 | `pmOptions.refresh = '2'`（`XHR_REFRESH`，premium 门禁 `G('xhr')`）；实际机制是**不 reload**，而是注入 `autoClick` 点击 `domainOptions.autoclick` 选择器（`Q_(tabId)` → `vh('autoClick',{selector })`），由页面自己的 AJAX 触发更新 | 保留：开 XHR 模式时**不重载页面**，改为点击「自动点击选择器」指定的元素（用户已确认保留该选择器输入框）；无选择器时跳过点击（等价于只做页内扫描占位，见 `05` §7） |

## D. 明确丢弃（不写进代码、不进 i18n、不留空壳）

| ARP 功能 | 证据位置 | 丢弃说明 |
| --- | --- | --- |
| 独立配置页 / 设置页（`account.autorefresh.io/time-interval`、`/page-monitor`、`/auto-start`、`/predefined`、`/countdown`、`/custom-scripts`、`/hotkeys`、`/notification-settings`） | `manifest.json` 的 `externally_connectable`、`content_scripts`、popup 里 `openTab` 到 `A/upgrade` 等 | 不做任何远端页面；仓内不出现 `account.autorefresh.io` |
| 自动启动 `autostart` / `asurl` / `asrestart` / `asrefresh` | `background.js` `_l` 默认表 | 丢弃 |
| 预定义 `predefined` / `defaultpgtxt` | 同上 | 丢弃 |
| 倒计时 `enableTimer` / `countdownType` / `countdownTime` / `countdownDate` | popup `计时器` tab（截图见 assets） | 丢弃；**连 tab 一起丢弃** |
| 页面监控器（关键词 `checkme`、`pmpattern`、`ANYCHANGES`、`searchInPage`、`areaSelector`、`ignoreKeywords`、`highlightKeyword`、`windowFocusOnDetection`、`monitorAlgorithm`、changeRules、AI monitor） | `监控` tab（截图 `monitor-refresh-type.png`）；`content-scripts/script.js` 大半体积 | 丢弃；只留 C1/C2 两个刷新类型 |
| 自定义脚本 `local:custom` 注入（`Hv`/`Vv`/`Uv` 在 `world:"MAIN"` 里 `createElement('script')`） | `background.js` | 丢弃 |
| 热键 `hotkeys` / `#shk-*` / `bN` | `background.js` | 丢弃 |
| 通知设置：桌面通知 `notifications`、声音 `sound*`、语音 `pm_voice*`、邮件 `pmemail`、Webhook `webhooks`、页内浮动通知、标签页警报 `activeTabs`/`tabAlert*` | `background.js`、`offscreen.html` | 丢弃；连同 `notifications`、`offscreen`、`cookies` 权限 |
| AI 能力（`aiMonitor`、`/v1/ai/*`、AI 助手浮球、AI 页面快照 `html2canvas` 类逻辑、`activityCapture`） | `popup` 的 AI 浮球按钮（截图右下角）、`background.js` AI 路由 | 丢弃 |
| 付费/套餐（`extension_status`、`grace`、`premium_usage`、`upgrade`、`license`、`clientId`、`analytics-enabled`、`usage_counters`、WXT analytics/GA） | `background.js` `G()` 特性门禁、`_locales` 大量 `premium` 文案 | 丢弃；**不留任何网络请求**，扩展离线可用 |
| 作用域隔离（此 URL / 此域名 / 全局） | `local:domain_config`、`local:site_scopes`、`save_scope_*`、`defaultSaveScope` | 丢弃；只保留全局配置 |
| 侧边栏（`sidePanel` 权限、`side_panel_enabled`） | `manifest.json`、popup 顶部 `Side Panel Off` 按钮 | 丢弃 |
| 页面内可视化计时器浮层（`visual`/`visualtimer`/`visualPosition`/`timer_style`） | popup 选项「显示可视计时器」 | 丢弃（用户未点名且与"不要倒计时"一致） |
| 验证码检测 / 错误页检测 / 休眠保活 `power_save` / 恢复滚动位置 `restore_scroll_position` / `noRestartOnUpdate` / `preventFormResubmission` | popup 选项区底部两项；设置页 `Power Save`、`Auto Scroll Restore`、`Don't restart on update`、`Prevent form resubmission` | 全部丢弃；`preventFormResubmission` 与 `restore_scroll_position` 列入 OQ-3 / `08`，默认不实现 |

## E. 与 ARP 的"近似但不同"清单（验收时必须按本扩展口径，而不是按 ARP）

1. **间隔档位**：本扩展 3/5/10/60 秒，ARP 是 5/10/15/60 秒 + 分钟级。
2. **自定义间隔**：本扩展只有"秒"这一种，且全局只有一个值；ARP 有"秒",还有独立"时/分/秒"模式，且按页面分别记。
3. **作用域**：本扩展无域名级/URL 级配置，也没有"当前站点"概念。
4. **XHR 刷新无 premium 限制**。
5. **keepActive 无 premium 限制**，且不再依赖 `sessionStorage` TTL 的 60s 兜底语义（改为每次刷新显式续期，见 `05` §6）。
6. **交互行为**：不区分"点击/键盘"两个子开关（ARP 有 `clickInteraction`/`keyboardInteraction` 但默认 false 且 popup 未暴露）。

## F. 非目标（明确不做）

- 不做 Firefox/Edge 兼容（`moz-extension://`、`Edg` 分支全部丢弃）。
- 不做 i18n 之外的多语言（仅 zh_CN，但保留 `_locales` 机制，见 `06`）。
- 不做云端同步/账号体系。
- 不收集任何遥测。
