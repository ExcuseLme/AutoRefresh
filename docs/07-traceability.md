# 07 · 需求可追溯矩阵

> 三列闭环：**用户要求** → **ARP 证据**（解包目录中的文件 + 可复核的代码片段/界面元素）→
> **本扩展落点**（文档章节 / 代码模块）→ **验收用例编号**（`09` §4 的 T-xx）。
>
> ARP 路径均相对 `D:\data\dl_fdm\Auto Refresh Plus  Page Monitor 9.3.0`。
> ARP 的 `background.js` / `content-scripts/*.js` 是压缩单行文件（`background.js` 仅 70 行、每行极长），
> 因此证据以"函数名 + 片段"标注，便于用 `Select-String`/编辑器全文检索定位。

## 1. 面板与形态

| 用户要求 | ARP 证据 | 本扩展落点 | 用例 |
| --- | --- | --- | --- |
| 丢弃独立复杂配置页，只提供面板 | `manifest.json`：`options_ui.open_in_tab:true` + `external.html` + `externally_connectable`（`*://*.autorefresh.io/*`）；`content_scripts` 仅注入 `*.autorefresh.io`。实测该站点为 `account.autorefresh.io/time-interval` 等多页配置中心（截图 `docs/assets/reference/settings-page-monitor.png`，左侧导航含 时间间隔/自动启动/预定义/倒计时/页面监控器/自定义脚本/热键/通知设置 共 8 页） | `01` D 行 1；`02` §3 manifest 中无 `options_ui`、无 `externally_connectable`、无 `content_scripts.matches=autorefresh.io` | T-01 |
| 面板为单屏滚动 | `popup.html` → `chunks/popup-BcW0V7JR.js`；实测 DOM：`body,#root{min-width:480px}`，内容区 `flex flex-1 flex-col gap-4 overflow-y-scroll bg-zinc-50 px-4`（`scrollHeight 965 / clientHeight 716`） | `04` §1/§7 | T-02 |

## 2. 常规功能（A1–A7）

| # | 用户要求 | ARP 证据 | 本扩展落点 | 用例 |
| --- | --- | --- | --- | --- |
| A1 | 强制刷新 | `background.js`：`lx()` 中 `await m.tabs.reload(i,{bypassCache:t})`；默认值 `_l.hardRefresh:false`；popup 开关 label 中文 `强制刷新` / 描述 `每次重新加载时绕过缓存`（zh_CN `hard_refresh`、`hard_refresh_desc`） | `05` §3.2；`03` `hardRefresh` | T-10 |
| A2 | 让页面在后台保持活动 | `background.js`：`Qy()`（MAIN world 补丁：改写 `Document.prototype.visibilityState/hidden/webkit*/hasFocus`、吞 `visibilitychange/webkitvisibilitychange/freeze/blur`、45s 派发 `mousemove/pointermove`）；`ib(tabId)` 以 `world:'MAIN'` 注入；`rb(tabId,on)` 写 `sessionStorage.__arp_keep_active`(60s)；`keep-active.js`（`document_start`+MAIN）自愈；`tab.autoDiscardable=false` 在 `lx()`。UI：`keep_active_background`=`让页面在后台保持活动`，`keep_active_background_desc`=`适用于标签页在后台时会退出登录的网站`；ARP 标为 premium（popup 快照 `switch "专业版功能：让页面在后台保持活动。打开公告。"`） | `05` §6（含 TTL 60s→5min 的有意偏离，ADR-003）；`03` `keepActive` | T-11 |
| A3 | 设置刷新次数 | `background.js` `Zw()`：`filter`出 `{refreshNumber:o, setRefNumber:l}`，`if(o && l>0 && c>l) return $b(t)`；`count` 在 `tT()` 中 `let c=(r.count??0)+1` 后 `J(e,{count:c,...})`。UI：`refresh_number`=`设置刷新次数`，`refresh_number_desc`=`达到固定次数后停止` | `05` §3.1 步骤 4/5（`>=` 而非 `>`，ADR-010）；`03` `refreshLimitEnabled/Count` | T-12 |
| A4 | 用户交互时的刷新行为 | `content-scripts/script.js`：`wT(e)`（click 捕获，`e.isTrusted && !g(target)`，`activeElement` 判 INPUT/TEXTAREA 后 `Ld('interaction',{isInput})`）、`TT(e)`（keydown，忽略 `ctrlKey/altKey/metaKey`）、`ET/DT` 挂载；`background.js` `xN(tab,{isInput})`：`if(... t?.isInput && i.ignoreInputField) return`，再按 `interactionAction` `pause/stop/restart`；`pS(tabId, waitSeconds)` 实现 restart 延迟；UI：`interactions_title_opt`=`用户交互时的刷新行为`，`interactions_switch_desc`=`使用页面时的行为`，`restart_wait_seconds_desc`=`Set the number of seconds to wait before the refresh starts again`，展开态三按钮（截图 `options-interaction-expanded.png`） | `05` §5.1/§5.2/§5.3；`04` §4.3 行 A4/A7 | T-13 |
| A5 | 重定向行为 | `background.js` `dx()`：`u = urlChangeFollow===0 ? 'canonical' : 'follow'`、`d = domainOptions.redirectionBehavior ?? u`、`fx={CANONICAL_URL:'canonical'}`、`m = d===CANONICAL ? X(e)?.canonicalUrl : undefined`；`lx()` 中 `n && nx(e.url)!==nx(n)` ⇒ `tabs.update` 再 reload。UI：`redirection_behavior`=`重定向行为`、`redirection_behavior_desc`=`刷新期间处理重定向`、`follow_all_redirects`=`跟随所有重定向`、`follow_canonical_url`=`跟随规范 URL`（截图 `options-redirection-menu.png`，两选项+勾选） | `05` §4；`03` `redirection` | T-14 |
| A6 | 忽略输入框交互 | `background.js` `xN`：`t?.isInput && i.ignoreInputField` ⇒ `return`；默认 `_l.ignoreInputField:true`；实测 `chrome.storage.local.options.ignoreInputField === true`；设置页标题「忽略输入框交互」，描述"即使您在输入框内点击或输入，也会保持刷新"（`account.autorefresh.io/time-interval`，uid 5_91/5_92） | `05` §5.2；`03` `ignoreInputField`（默认 true） | T-15 |
| A7 | 用户交互时的更新行为 | 同 A4 的底层键 `options.interactions`。第二个入口：设置页 `time-interval` 的「用户交互时的更新行为」（uid 5_88）+ 其描述"当您与页面交互（鼠标点击或键盘）时，Auto Refresh Plus 可以暂停、停止或重新启动倒计时"（uid 5_89）+ 同页「忽略输入框交互」紧邻其后 | `05` §5.2（与 A4 共用开关，见 OQ-1）；`04` §4.3 | T-16 |

## 3. 间隔能力（B1–B5）

| # | 用户要求 | ARP 证据 | 本扩展落点 | 用例 |
| --- | --- | --- | --- | --- |
| B1 | 固定档改 3/5/10/60 秒 | `chunks/popup-BcW0V7JR.js` `a5` 数组：`{id:'5000',amount:'5'}`、`'10000'/10`、`'15000'/15`、`{id:'custom-60',amount:'60',customSeconds:60}`、`'300000'/5(分)`、`'600000'/10`、`'900000'/15`；值映射 `Fde={'stand-5000':5e3,...}`；schema `time_type` 允许 `stand-5000|10000|15000|300000|600000|900000|custom|timer|rand` | `03` `fixedSeconds` **单一数据源**（ADR-021 起删 `fixedPreset`/`customSeconds`，预设只作 UI 快捷数字）；`04` §4.1 | T-20 / T-81..T-88 |
| B2 | 自定义可输入 >0 任意值 | 固定档内自定义 chip：`{id:'custom-60',customSeconds:60}` + `onCustomIntervalChange` ⇒ `{time_type:'custom', custom_interval:e}`；`qg()` 中 `if(n==='custom') return Kg(e.custom_interval*1e3)`，`Kg`：`>0` 否则回落 12000 | `03` 固定档唯一 `fixedSeconds`（ADR-021）；`05` §2 `clampSeconds`；ADR-007 改为**拒绝非法** | T-21 / T-82..T-87 |
| B3 | 自定义值全局同步 | ARP 反证：`custom_interval` 属域级 schema（`cl`/`Pd` 均含 `custom_interval` 且存在 `domains`/`global` 双层），并且用 `localStorage.time_type` 记"上次模式"（`zde()` 中 `localStorage.getItem('time_type') || 'stand-5000'`）—— 值仍按作用域分存 | `03` §1 `customSeconds` 单字段；`01` §E-2 | T-22 |
| B4 | 随机间隔 min/max 闭区间，每轮重取 | `background.js` `qg()`：`r=Number.isInteger(t); i = r ? n-t+1 : n-t; a = Math.random()*i+t; return Kg(r? Math.floor(a)*1e3 : Math.floor(a*1e3))`；`$_()` 提供"避免与上一轮相同"，重试上限 10；默认 `randomMin:5, randomMax:30`（`_l.randomMin/randomMax`） | `05` §2 `nextDelayMs`；`03` `avoidRepeatRandom` | T-23 |
| B5 | 随机范围合法性 | popup 快照：最小 `valuemin=1`，最大 `valuemin` 随最小变化（`uid=2_2 value=5 valuemin=1`, `uid=2_4 value=30 valuemin=6`）；`f=async(e,t)=>{let n=Math.max(e,0); i(t==='min'?{randomMin:n}:{randomMax:n})}` | `03` §2 不变式；`04` §4.1 内联报错 | T-24 |

## 4. 刷新类型（C1–C2）

| # | 用户要求 | ARP 证据 | 本扩展落点 | 用例 |
| --- | --- | --- | --- | --- |
| C1 | 完整页面刷新 | `background.js` `Ux={FULL:'1', XHR_REFRESH:'2'}`；`pmOptions.refresh` 默认 `'1'`（`pl()` 中 `pmOptions:{refresh:'1',...}`）；UI `full_page`=`完整页面刷新`、`refresh_type_help`（zh "完整页面刷新"描述：重新加载整个 URL） | `05` §3.2；`03` `refreshType:'full'` | T-30 |
| C2 | XHR 刷新 | `background.js`：`Fx()` 判 `pmOptions.refresh===Ux.XHR_REFRESH && await G('xhr')`；`Q_()`：`if(await G('xhr') && n.pmOptions.refresh==='2' && n.autoclick) → vh('autoClick',{selector:n.autoclick,hints})`；`Ix()`：`if(await Fx(e) && r.autoclick && t) await Q_(e)`；`Jw()`/`Zw()` 中 `u && !d ? (Jw(e),Q_(e)) : dx(...)` ⇒ **XHR 不 reload**；内容脚本 `G('autoClick', ... Vd(selector) → Tp(element))`；UI `without_full`=`XHR 刷新`，带 premium 皇冠（截图 `monitor-refresh-type.png`） | `05` §7（保留选择器、去掉 premium，用户已确认）；**点击必须是完整 pointer/mouse 序列**（`05` §7.2 / ADR-015，实测 `el.click()` 对 Gmail/网易邮箱 0 生效）；失败轮次不计次数（`05` §7.3 / ADR-016）；面板内置「测试选择器」（`05` §7.4） | T-31 / T-31d / T-31e / T-54 |
| C2b | 单击 / 双击 | ARP 只有单击（`Tp(el)` 单次 `click`），无双击概念 | `05` §7.7 / ADR-020：`autoClickAction` 决定派发 1 轮还是 2 轮按下序列 + `dblclick` | T-70..T-73 |
| C2c | 元素拾取器（新增） | ARP 有 `selectorHints`（用户手动 pick 提示）+ premium `cssxSelectors`，其拾取器本身也是自建覆盖层 | `10` §1 / ADR-018 / ADR-019：`lib/picker.ts` + `lib/selector.ts`，**不引入 `debugger` 权限** | T-60..T-69 |
| C2a | 刷新类型从「监控」tab 搬到「间隔」tab | popup 快照：`监控` tab 下第一张卡片即「刷新类型」（`uid=6_0/6_1/6_3/6_4`）；`间隔` tab 无此控件 | `04` §4.2（位于间隔段落之后、选项之前，**不再有监控 tab**） | T-32 |

## 5. 丢弃项（逐项对应证据，防止"复活"）

> **执行方式**：`pnpm check:scope`（脚本 `scripts/check-scope.mjs`，T-50 的自动化版本）。
> 它在下表中每个"grep X"上真的跑一遍，外加构建产物 manifest 的权限白名单校验；
> 注释行豁免（设计文档里写"我们没有 X"是必要的）。当前结果：**0 命中**。

| 丢弃项 | ARP 证据（存在性证明） | 检查方式 |
| --- | --- | --- |
| 独立配置页 | `manifest.json` `options_ui`/`external.html`/`externally_connectable`；`content-scripts/script.js` 为 `*.autorefresh.io` 上的注入 UI | 全仓 grep `autorefresh.io`、`options_ui`、`externally_connectable` 必须 0 命中 |
| 自动启动 / 预定义 | `_l.autostart/asurl/asrestart/asrefresh/rpt/rpttext/pdcheck/pdurl/defaultpgtxt` | grep 这些键名 0 命中 |
| 倒计时 | popup `计时器` tab（截图 `popup-wide-idle.png` 顶部 tab 行）；`_l.enableTimer/countdownType/countdownTime/countdownDate` | grep `countdown` 0 命中（除注释） |
| 页面监控器 | popup `监控` tab（`monitor-refresh-type.png` 下方「监控模式」「你在等什么？」=AI 输入框、「监控区域」「警报设置」）；`_l.pmpattern/checkme/ignoreKeywords/searchInPage/areaSelector/anyTimeDetection/highlightKeyword/windowFocusOnDetection/monitorAlgorithm`；`content-scripts/script.js` 的 `Ky()`/`ab()`/`tb()` 全页 diff | grep 上述键 0 命中 |
| 自定义脚本 | `background.js` `Hv()`/`Vv()`/`Uv()` + `local:custom` | grep `local:custom`、`createElement('script')` 0 命中 |
| 热键 | `_l.hotkeys`、`#shk-1..5`、`bN()`、`IT()/PT()/MT()` | grep `hotkey`、`#shk` 0 命中 |
| 通知设置 | `_l.sound/soundurl/soundvolume/pm_voice*/pmemail/webhooks/pm_on_page_notification/pm_notification_message/tabAlertSection/tabAlertTime`；`offscreen.html`+`assets/sound/*` | grep 上述键与 `notifications` 权限 0 命中 |
| AI | popup 右下角 AI 浮球（快照 `uid=1_56 "打开 AI 助手"`）；`background.js` `/v1/ai/monitor`；`aiMonitor` schema | grep `aiMonitor`、`/v1/ai` 0 命中 |
| 付费/套餐 | `background.js` `G(feature)` 特性门禁 + `extension_status`/`premium_usage`/`grace`/`clientId`/`analytics-enabled`/`usage_counters`；`_locales` 中 `premium`/`upgrade`/`grace_period_*` 大量条目；popup 中 `Side Panel Off`/账户菜单/`升级计划` | grep `premium`、`upgrade`、`grace`、`clientId`、`analytics` 0 命中；manifest 无网络相关权限 |
| 作用域隔离 | `local:domain_config`、`local:site_scopes`、`save_scope_*`、`defaultSaveScope`、`domainOptions` 双层结构 | grep `domain_config`、`site_scopes`、`save_scope` 0 命中 |
| 侧边栏 | `manifest.permissions` 含 `sidePanel`；popup `Side Panel Off` 按钮（快照 `uid=1_10`）；`local:side_panel_enabled` | grep `side_panel`、`sidePanel` 0 命中 |
| 页面内计时浮层 | `_l.visualtimer/visualPosition/timer_style`；`TS()` / `O('showVisualTimer')` | grep `visualtimer`、`showVisualTimer` 0 命中 |
| 验证码/错误页检测 | popup 选项区末尾两项（快照 `uid=1_51..1_54`）；`background.js` `Bb()/Vb()/Rb()/zb()` | grep `captchaDetection`、`errorDetection` 0 命中 |
| 阻止系统睡眠 | `_l.power_save`；`$h()` 中 `m.power.requestKeepAwake('system')`；manifest `power` | grep `power_save`、`requestKeepAwake` 0 命中 |

## 5.1 需求 → 实现落点（实现完成后的对照）

| 需求 | 实现文件 | 单测 / 手工验证 |
| --- | --- | --- |
| 丢弃独立配置页 · 只有 popup | `wxt.config.ts`（无 `options_ui`）、`src/entrypoints/popup/*` | `check:scope` 0 命中；manifest 无 `options_ui` |
| A1 强制刷新 | `src/lib/refresh.ts`（`reload({bypassCache})`）、`src/lib/options.ts` | 面板开关 + `refreshLimitEnabled` 手工验证 |
| A2 后台保持活动 | `src/lib/keep-active.ts`（MAIN 补丁）、`src/lib/keep-active-runtime.ts`（注入/TTL/清场） | 手工：后台标签 `document.hidden===false`、`__arKeepActivePatched===true`、stop 后 `sessionStorage` 键消失 |
| A3 刷新次数上限 | `src/lib/url.ts` `reachedLimit`（`>=`）、`src/entrypoints/background.ts` `executeRound` | `tests/url-and-limits.test.ts`；手工：2s×上限5 → 服务端恰好 5 次后停 |
| A4/A7 交互行为 | `src/lib/interaction.ts`、`background.ts` `onInteraction` | `tests/session-and-interaction.test.ts`；手工：stop/pause/restart 三态 + wait 恢复 |
| A5 重定向行为 | `src/lib/url.ts` `pickTargetUrl`、`refresh.ts` | `tests/url-and-limits.test.ts`；手工：302 场景下 follow 继续 `/target`、canonical 拉回 `/anchor` |
| A6 忽略输入框 | `src/lib/interaction.ts` | `tests/session-and-interaction.test.ts`；手工：`ignoreInputField` true/false 各点一次输入框 |
| B1 固定档 3/5/10/60 | `src/lib/options.ts` `FIXED_PRESETS` | `tests/url-and-limits.test.ts`（默认值断言） |
| B2 固定档可输任意整数秒 | `src/lib/number-input.ts`、`options.ts` `fixedSeconds` | `tests/number-input.test.ts`、`tests/interval.test.ts`、`tests/validate.test.ts`（`migrateV1ToV2` 保值） |
| B3 自定义全局同步 | `src/lib/storage.ts`（单 key `options`） | 手工：改自定义值后换标签页仍一致 |
| B4/B5 随机闭区间 | `src/lib/interval.ts` `nextDelayMs` | `tests/interval.test.ts`（13 例，含边界与去重） |
| C1/C2/C2a 刷新类型 | `src/components/RefreshTypeSection.tsx`、`refresh.ts`、`content.ts`、`dom-click.ts`、`selector.ts`、`picker.ts` | `check:scope` 无 premium；`tests/dom-click.test.ts`（单击/双击序列）、`tests/selector.test.ts`（5 层降级与唯一性）；手工：Gmail/网易邮箱每轮产生页面自身 XHR；真实站点实测拾取器产出唯一 selector |
| 会话恢复（SW 被回收） | `src/lib/session-store.ts`、`background.ts` `ensureReady` | 手工：60s 间隔启动 → 重载扩展 → 会话仍在 `storage.session` |

## 6. 非功能要求

| 要求 | 证据/理由 | 落点 |
| --- | --- | --- |
| 离线可用、零遥测 | ARP 有 `analytics-enabled`、`clientId`、GA/`/mp/collect`、`/v1/extension/status` 轮询 | `02` §3 权限表；`07` §5 AI/付费行 |
| MV3 SW 可被回收而不丢刷新任务 | ARP 靠 CS 每秒心跳保活（脆弱） | `05` §1（offscreen 托管 + 三重兜底） |
| 包体远小于 ARP | ARP 解包共 7.47MB / 100 个文件（`chunks/popup-BcW0V7JR.js` 1267KB、`content-scripts/script.css` 1062KB、`content-scripts/script.js` 676KB、`background.js` 367KB、`I18nProvider` 242KB、`popup-DcUX7WOF.css` 228KB、另有 `external-`/`permissions-` 两份 ~220KB CSS） | `09` §5 目标：< 300KB（不含 sourcemap） |
