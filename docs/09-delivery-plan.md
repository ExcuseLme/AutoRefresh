# 09 · 交付计划与验收

## 1. 里程碑

> 每个里程碑结束时：`pnpm build` 通过、`pnpm test` 通过、`07` 的矩阵"落点"列已更新、`README` 变更记录加一行、
> **`package.json` 的 `version` 已递增**（ADR-029；面板头部显示这个版本号，用户靠它判断扩展是否重载成功）。

### M0 · 骨架（0.5 天）

- [x] `wxt.config.ts`：manifest（权限 `tabs/storage/scripting/alarms/offscreen`、`host_permissions:["<all_urls>"]`、`default_locale:"zh_CN"`、content script `document_start`）
- [x] Tailwind v4 接入 + `04` §6 的 token 写入 `:root` / `.dark`
- [x] `src/lib/messages.ts` 类型全集；`src/lib/storage.ts` 的 `Options` + `DEFAULT_OPTIONS` + `migrate`
- [x] `public/_locales/zh_CN/messages.json` 按 `06` §3 全量落盘
- [x] 空 popup 能打开（无功能）

**DoD**：`load unpacked` 后点图标能弹出空白面板，控制台无错。

### M1 · 面板（1.5 天）

- [x] `Header`（主按钮 + 状态摘要）
- [x] `IntervalSection`（三模式分段 + 固定 4 chip + 自定义 chip + 随机两输入 + 自定义输入 + 校验）
- [x] `RefreshTypeSection`（两段 + XHR 选择器输入）
- [x] `OptionsSection`（折叠 + 6 行 + A3/A4 展开子内容）
- [x] `NumberStepper` / `SegmentedControl` / `SwitchRow` / `Select`
- [x] 所有改动手写 `OPTIONS_PATCH`（此时 SW 可先只做 echo）

**DoD**：面板与 `assets/reference/interval-fixed.png` 布局一致（截图对比见 §3）；改动后重开面板值保留。

### M2 · 引擎（2 天）

- [x] `entrypoints/offscreen`：`ARM/DISARM/PING`、`TICK_DONE`、`TICK_PROGRESS`
- [x] `background.ts`：`sessionStore`（含 `storage.session` 镜像）、`START/STOP/PAUSE/RESUME`、token 校验、60s `PING`、`alarms` 兜底、SW 重启恢复
- [x] `lib/interval.ts`：`nextDelayMs`（含 `avoidRepeatRandom`）+ `clampSeconds`
- [x] `lib/refresh.ts`：完整刷新分支（keep-active 续期 → 重定向 → reload/update+reload）、计数、上限
- [x] badge（若 OQ-4 采纳）

**DoD**：`09` §4 的 T-10 ~ T-14、T-20 ~ T-24、T-30、T-40 通过。

### M3 · 内容脚本（1 天）

- [x] `content.ts`：交互上报（click 捕获 + keydown，`isTrusted` + `activeElement` 判输入框）
- [x] keep-active：MAIN world 补丁注入 + `sessionStorage` TTL 自愈 + 45s 伪活动 + `autoDiscardable`
- [x] XHR：`AUTOCLICK` 消息 + `querySelector` + 失败记录
- [x] `lib/interaction.ts`：SW 侧决策（A4/A6/A7）

**DoD**：T-11、T-13、T-15、T-16、T-31 通过。

### M4 · 收口（0.5 天）

- [x] 清理：全仓 grep 丢弃项（`07` §5 的检查表）0 命中
- [x] `vitest` 用例补齐（`05` §9）
- [x] 中文文案通读（`06` §3）与面板实际渲染一致
- [x] 构建产物体积检查（§5）

## 2. 工作量与顺序

```
M0 ──► M1 ──► M2 ──► M3 ──► M4
        │      │      │
        │      └──────┴──► 可并行：M1（UI）与 M2（引擎）由两人分头做，
        │                    契约是 lib/messages.ts + storage.ts（M0 就要冻结）
```

总计约 **5.5 人天**（单人）。关键路径 M0→M2（引擎最难）。

## 3. 视觉验收（截图对比）

拿本扩展面板在 480px 宽度下的截图，与下列参考图对比：

**本扩展的实拍截图**（本轮留档，可直接对比）：

| 本扩展截图 | 覆盖的参考图 |
| --- | --- |
| `docs/assets/reference/impl-popup-default.png` | 全默认态（固定 10s、完整刷新、选项折叠区首屏） |
| `docs/assets/reference/impl-popup-final-top.png` | 固定档 chip 行 + XHR 选中态（含选择器输入） |
| `docs/assets/reference/impl-popup-random.png` | `interval-random.png` |
| `docs/assets/reference/impl-popup-options.png` | `options-interaction-expanded.png`（含 A3/A4 展开、重定向下拉） |
| `docs/assets/reference/impl-popup-running2.png` | 运行中头部状态（「7 秒后刷新 · 第 2/20 次」+ 暂停/停止按钮） |

| 参考图 | 对比点 |
| --- | --- |
| `docs/assets/reference/interval-fixed.png` | 三段分段控件、大号数字、chip 行、选项卡片行高/图标尺寸 |
| `docs/assets/reference/interval-random.png` | 双输入框并排、摘要行 |
| `docs/assets/reference/interval-custom.png` | 单输入框 |
| `docs/assets/reference/options-interaction-expanded.png` | 展开态三按钮（停止选中=红框红字；本扩展同款） |
| `docs/assets/reference/options-redirection-menu.png` | 下拉展开两项 + 勾选态 |
| `docs/assets/reference/monitor-refresh-type.png` | 刷新类型分段（本扩展去掉右上"高级版"皇冠） |

允许的差异：品牌名（`AutoRefresh` 而非 `Auto Refresh Plus`）、无版本号行、无通知铃铛/侧边栏/AI 浮球/账户菜单、
无 premium 皇冠、chip 文案为 3s/5s/10s/60s。

## 4. 验收用例矩阵

> 编号在 `07` 里被引用。**P** = 必须通过；**S** = 抽检。

### §4.1 形态与面板

| ID | 用例 | 预期 | P/S |
| --- | --- | --- | --- |
| T-01 | 安装后扩展的 `options_ui` 是否为空、是否存在任何指向外部站点的链接 | 无 `options_ui`、无 `externally_connectable`、无外链 | P |
| T-02 | 打开 popup，检查是否有 tab 切换与监控/计时器 tab | 单屏滚动，无 tab | P |
| T-03 | 480px 宽截图与参考图对比 | 布局一致（允许差异见 §3） | P |
| T-04 | 折叠"选项"后重开面板 | 折叠状态保留（`localStorage`） | S |
| T-05 | 深色模式下打开面板 | token 切换正常，文字对比度可读 | S |

### §4.2 间隔

| ID | 用例 | 预期 | P/S |
| --- | --- | --- | --- |
| T-20 | 固定档点 3/6/10/60 四个 chip | 选中态正确，`fixedSeconds` 落库，摘要显示对应秒数 | P |
| T-21 | 固定档点"自定义"chip，输入 12.5 | 落库 `customSeconds=12.5`；切到其他 chip 再回来，值仍是 12.5 | P |
| T-21b | 输入 0 / -1 / 空 | 内联报错，不落库，当前值不变 | P |
| T-22 | tab A 设自定义 7.5；tab B 打开面板 | tab B 显示同一值 7.5（全局同步） | P |
| T-23 | 随机档设 min=5 max=6，运行 20 轮 | 每轮等待为 5 或 6，且不出现连续相同（`avoidRepeat` 默认开） | P |
| T-24 | 随机档 max 设小于 min | 内联报错，不落库 | P |
| T-25 | 运行中把固定 10s 改成 60s | 下一轮起生效（当前轮的等待不被强行中断） | P |
| T-26 | 切模式（固定→随机→自定义） | 三次切换都保留各自上次的值 | S |

### §4.3 刷新与开关

| ID | 用例 | 预期 | P/S |
| --- | --- | --- | --- |
| T-10 | 开"强制刷新"，DevTools Network 观察 | 请求 `cache-control`/`from disk cache` 行为符合 bypass（`tabs.reload({bypassCache:true})`） | P |
| T-11 | 开"保持活动"，把 tab 切走 3 分钟（间隔 60s） | 页面继续刷新；`document.hidden` 在页面里读到 `false`（页面控制台可验）；`autoDiscardable=false` | P |
| T-11b | 同上但间隔 5 分钟（验证 ADR-003 的 TTL 延长） | 仍保持活动，不被判后台 | P |
| T-12 | 开"设置刷新次数"=3，开始刷新 | 刷 3 次后自动停止，徽章/状态变"未运行" | P |
| T-12b | 关闭"设置刷新次数"，开始刷新 | 持续刷新不停止 | P |
| T-13 | 开交互=停止，点击页面 | 立即停止刷新 | P |
| T-13b | 开交互=暂停，点击页面 | 进入"已暂停"，点"继续"恢复且 count 不变 | P |
| T-13c | 开交互=重新开始 + 等待 5s，点击页面 | 进入"等待 5 秒后重新开始"，5s 后重新刷新 | P |
| T-14 | 重定向=跟随所有重定向，页面 302 到 /b | 持续刷新 /b | P |
| T-14b | 重定向=规范 URL，页面 302 到 /b | 刷新一轮后回到起始 URL | P |
| T-15 | 开"忽略输入框交互"（默认开），在输入框中打字 | 不触发交互行为 | P |
| T-15b | 关"忽略输入框交互"，在输入框中打字 | 触发交互行为 | P |
| T-16 | 交互总开关关闭时点页面 | 无任何反应 | P |

### §4.4 刷新类型

| ID | 用例 | 预期 | P/S |
| --- | --- | --- | --- |
| T-30 | 完整页面刷新 | 每轮整页重载（Network 出现 main_frame 请求） | P |
| T-31 | XHR 刷新 + 选择器指向"加载更多"按钮 | 每轮该按钮被**完整点击序列**命中（见 `05` §7.2），页面不整页重载 | P |
| T-31b | XHR 刷新 + 选择器为空 | 不重载、不崩溃；红字「未设置自动点击元素选择器，本轮未刷新」，`count` 不涨 | P |
| T-31c | XHR 刷新 + 选择器无效（`#nope`） | 不崩溃；红字「选择器没有匹配到元素…」，徽章变红，`count` 不涨 | P |
| T-32 | 检查"刷新类型"所在位置 | 在"间隔"段落内（间隔之后、选项之前），且不存在"监控"tab | P |
| T-90 | 在 A 页选元素并启动 XHR；去 B 页选元素 | A 页会话的点击目标**不变**（ADR-022） | P |
| T-91 | `pageKey` 忽略 query 与 #hash | 同路径不同 query/hash ⇒ 同一条记录；不同路径 ⇒ 不同记录 | P |
| T-92 | 触发方式按页面 | A 页 `double` + B 页 `single` 各自独立 | P |
| T-93 | 会话中途页面跳转（follow） | 仍用**启动时那个页面**的配置，不改去点新页面的元素 | S |
| T-94 | v2 存档升级 | `autoClickSelector`/`autoClickAction` 被丢弃，其它字段保留，schema=3 | P |
| T-95 | 页面没有配置就启动 XHR | 该轮 `xhr_no_selector`、不计次数、红字提示；**不回落**到别的页面 | P |

### §4.5 鲁棒性

| ID | 用例 | 预期 | P/S |
| --- | --- | --- | --- |
| T-40 | 运行中在 `chrome://serviceworker-internals` 手动 Stop 扩展的 SW | 下一轮仍按时执行（offscreen 不受影响） | P |
| T-41 | 运行中关闭 offscreen（DevTools 关闭其页面） | 60s 内被探活重建，刷新恢复 | S |
| T-42 | 运行中关闭该 tab | 会话清除、定时器 DISARM、无报错 | P |
| T-43 | 运行中浏览器重启 | 不自动恢复刷新（ADR/`03` §4 的决策），面板显示"未运行" | P |
| T-44 | 在 `chrome://settings`、`about:blank` 上点"开始" | 明确提示"此页面无法自动刷新"，不建会话 | P |
| T-45 | 会话中把间隔改成最小合法值 1s 并运行 30s | 不崩溃、不卡死；页面被频繁刷新（符合配置） | S |
| T-46 | 同时运行 ARP 与本扩展 | 两者互不干扰（键名前缀差异），本扩展功能正常 | S |
| T-47 | 输入框里输入 `2.5` / `1.5` 并失焦 | 被拒绝：值回滚到原值（不静默截断成 2/1） | P |

### §4.6 清理检查

| ID | 用例 | 预期 | P/S |
| --- | --- | --- | --- |
| T-50 | `07` §5 的所有 grep 检查（`pnpm check:scope`） | 全部 0 命中 | P |
| T-51 | `vitest` 全绿（`pnpm test`） | — | P |
| T-52 | ~~构建产物体积~~ | **不设限（用户明确：自用扩展，不管体积）** | — |
| T-53 | 无任何网络请求（DevTools 全局观察 5 分钟） | 除页面自身请求外，扩展自身 0 请求 | P |

## 4.7 本轮实测结果（2026-11-24，`load unpacked` 真实浏览器）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| T-01 / T-02 / T-32 | ✅ | 截图 `impl-popup-default.png` / `impl-popup-final-top.png`：单屏滚动、无 tab、刷新类型在间隔之后 |
| T-03 | ✅ | 480px 下 `root 480×600`、内容区可滚（`scrollHeight 882 / clientHeight 541`）；截图 6 张 |
| T-10 / T-12 | ✅ | 2s 间隔 + 上限 5：服务端恰好 5 次后停（`loads` 6→21 停住，6s 内 0 增量） |
| T-11 | ✅ | 后台标签页内 `document.hidden===false`、`visibilityState==='visible'`、`hasFocus()===true`、`__arKeepActivePatched===true`；停止后 `sessionStorage.__ar_keep_active` 为 `null` |
| T-13 / T-13b / T-13c | ✅ | stop：会话被清除；pause：`status='pause'` 且 `count` 保留，RESUME 后回 `start` 且 `count` 递增；restart：`status='wait'`、`delayMs=30000`、`waitReason='interaction'` |
| T-14 / T-14b | ✅ | follow：302 后服务端记录连续 `/target`；canonical：起点 `/anchor`、中途手动导航到 `/target`，下一轮被拉回 `/anchor` |
| T-15 / T-15b | ✅ | `ignoreInputField=true` 点输入框后会话仍 `start`；`false` 时同一操作导致会话被清除 |
| T-30 | ✅ | 完整刷新：服务端 `loads` 逐轮 +1 |
| T-31 | ✅ | XHR（本机测试站）：服务端 `clicks=3 / loads=3`；停止后不再增长 |
| T-31d | ✅ | XHR（**Gmail 收件箱**真实站点，选择器 `[aria-label="刷新"]`）：3s 间隔 11s 内触发 4 次 `/sync/u/0/i/s?…`，`count=4`、`lastError=null` |
| T-31e | ✅ | XHR（**网易邮箱**真实站点，选择器 `#_mail_button_212_1083 > span`）：3s 间隔 8s 内触发 9 次 `/js6/s?…func=mbox:listMessages`，`count=3`、`lastError=null` |
| T-31c | ✅ | 失效选择器 `#_mail_button_228_1148 > span`：`count=0` 不涨、`lastError='xhr_not_found'`、`failedRounds` 递增（2s×7s 内为 4） |
| T-31f | ✅ | 面板「测试选择器」：命中 → `命中 1 个元素：<div> “刷新”`；多命中 → `48`；语法错 → `xhr_invalid`；未命中 → `xhr_not_found` |
| T-40 | ✅ | 60s 间隔运行中重载扩展：`storage.session.sessions` 仍持有该会话（`armedAt/delayMs/timerToken` 齐全），SW 重新就绪后恢复 ARM |
| T-42 | ✅ | 关闭运行中的标签页：`storage.session.sessions` 变为 `{}` |
| T-44 | ✅ | 在扩展页上点"开始"返回 `{ok:false, code:'err_page_unavailable'}` |
| T-47 | ✅ | `2.5` 输入后失焦 → 输入框回滚为原值，`storage.local.options` 不变 |
| T-48 | ✅ | 内容脚本按需注入：扩展重载后旧标签页上点「测试选择器」直接成功（无需手动刷新页面） |
| T-49 | ✅ | i18n key 只含 `[a-zA-Z0-9_]`；`messages.json` 86 个 key 全部有非空 message 且无 `%N` 占位符 |
| T-50 | ✅ | `check:scope`：0 命中（58 特征串 + 7 项权限） |
| T-51 | ✅ | **124 个用例 / 8 个文件全绿** |
| T-52 | ✅ | 312.16 KB。**用户明确「别管构建体积限制」，此项不再作为验收门槛**（保留数字仅供对照；ARP 解包 7.47MB，本扩展仍是它的 1/24） |
| T-53 | ✅ | 全仓无 `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/任何 URL 常量（`check:scope` 之外的独立 grep） |
| T-54 | ✅ | ADR-015 对照实验：同一按钮 `el.click()` → 0 次网络请求；完整序列 → 每轮 1 次（Gmail / 网易邮箱各测 3 轮） |

未在真实浏览器中覆盖、仅有单测或代码审读的：T-41（offscreen 被关）、
T-43（浏览器重启）、T-46（与 ARP 并存）。这三项的代码路径与 T-40/T-42 共用，风险已登记在 `08` R2/R8。

## 4.8 第二轮实测结果（2026-11-24，`load unpacked` 真实浏览器）

第二轮需求（`docs/10`）：元素拾取器、单击/双击、间隔交互改版。

### 间隔交互（ADR-021）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| T-80 | ✅ | 面板只有「固定 / 随机」两段，快照里不存在「自定义」tab |
| T-81 | ✅ | 点 `60秒` chip → 输入框变 60、chip 高亮、`storage.local.options.fixedSeconds=60` |
| T-82 | ✅ | 点 `+` 一次 → 60→61，落库 61；**四个 chip 全部 `aria-pressed=false`**（61 不在预设集，正确） |
| T-83 | ⚠ | 点 `−` 一次 → 61→60 正常；下限 1 的行为由单测覆盖（面板层面未实测到下限） |
| T-84 | ✅ | 手动输入 `7` + 回车 → 落库 7、显示 7、无 chip 高亮 |
| T-85 | ✅ | 输入 `2.5` → 回滚为原值（`stored=5, shown=5`），未落库 |
| T-85b | ✅ | 输入 `86401`（超上限）→ 被夹到 `86400`，未写入超限值 |
| T-86 | ✅ | 固定档**只有一个**数字输入（`input[name=fixedSeconds]`），无第二个输入框、无需切 tab |
| T-87 | ✅ | v1 存档 `intervalMode='custom'` + `customSeconds=7` → 迁移后 `fixed` + `fixedSeconds=7`（单测 `migrateV1ToV2`） |
| T-88 | ✅ | v1 存档 `fixedSeconds=60` → 迁移后不变（单测） |
| T-88b | ✅ | 迁移首读后**回写 storage**：`schemaVersion=2`，`customSeconds`/`fixedPreset` 键均不存在 |

### 单击 / 双击（ADR-020）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| T-70 | ✅ | `action='single'` 派发到真实站点元素：`clicks=[1]`、`downs=1`、`dblclick=0` |
| T-71 | ✅ | `action='double'`：`clicks=[1,2]`、`downs=2`、`dblclick=1` |
| T-72 | ✅ | `click.detail` 依次为 1、2；`dblclick.detail === 2`（页面事件探针实测） |
| T-73 | ✅ | `refreshType='full'` 时快照里没有「触发方式」分段 |
| T-73b | ✅ | 失败码：`AUTOCLICK` 传 `###` → `invalid`；传不存在选择器 → `not-found` |

### 元素拾取器（ADR-018 / ADR-019）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| T-60 | ✅ | `PICKER_START` → 宿主 `#ar-picker-host` 挂上（`pointer-events:none`、`z-index:2147483647`），光标变 `crosshair` |
| T-61 | ✅ | 鼠标移到真实站点某视频卡片标题 → 高亮框圈住目标，悬浮卡片显示 `<h3> “GTA6的剧情为什么会被玩家吐槽？”` / `[title="GTA6的剧情为什么会被玩家吐槽？"]`；截图 `impl-v2-picker.png` |
| T-62 | ✅ | 生成结果走 **T0 语义属性**（`title` 唯一时，比结构路径短且稳） |
| T-63 | ✅ | 结构路径兜底与 T2/T3/T4 降级由 `tests/selector.test.ts` 覆盖（26 个用例全部断言"必须唯一命中"） |
| T-64 | ✅ | 拾取中按 `Esc` → 宿主移除、光标恢复、**原 selector 不变** |
| T-65 | ✅ | 拾取中在元素上派发 `pointerdown` → 页面自己的监听器计数 **0**（`pointerdown:0, click:0`），页面动作确实被吞掉 |
| T-66 | ✅ | 点选后 `storage.local.options.autoClickSelector` 更新为生成的 selector |
| T-68 | ✅ | 取消/点选后宿主与光标全部还原（`host:false, cursor:""`） |
| T-69 | ✅ | 同一元素反复生成结果稳定（单测「幂等」用例） |
| T-67 | ⚠ | 未走完真实 popup 里点「选择元素」按钮的流程（脚本无法触发真实 popup 的按钮）；`PICKER_START` 消息链路与 `chrome.action.openPopup()` 兜底均已验证存在（Chrome 158，`openPopup.length===0`） |

### 按页面隔离 selector（ADR-022，第三轮）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| T-90 | ✅ | A 页（`10.25.150.155:8080/ms/index`）写 `.btn-on-A` 并启动 XHR 会话；去 B 页（`10.25.197.170:19090/…`）写 `[aria-label="B 页的元素"]` 后，A 的 `pageSelector.selector` **仍是 `.btn-on-A`**，`sessionPageKey` 仍指向 A |
| T-91 | ✅ | 两个同在 `/app/discover` 的标签页（仅 query/hash 不同）合并为**同一条**记录；不同路径各一条 |
| T-92 | ✅ | A 设 `double`、B 设 `single` 后两条记录各自独立（`isolated: true`） |
| T-95 | ✅ | A 页 selector 指向不存在的元素 → 该轮 `lastError='xhr_not_found'`、`count` 不涨，且**没有**回落到 B 页的 selector |
| T-94 | ✅ | 单测 `migrateV2ToV3`：两个全局字段被删、其它字段保留、schema=3；v1 存档连续迁到 v3 |
| 面板回显 | ✅ | 输入框显示当前页 selector，下方显示 `仅对当前页面生效：http://10.25.150.155:8080/ms/index`（截图 `impl-v3-per-page.png`） |

### 固定档单行 + 预设 6 秒（ADR-024，第五轮）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| 预设 chip 与数字同行 | ✅ | 4 个 chip 全部 `top === 93`（同一行），最右 chip 右边缘 366 = 卡片右边缘 366（`fitsInCard: true`），无溢出 |
| 卡片高度 | ✅ | 106px → **74px**；内容区 `scrollHeight` 623 → **591** |
| 预设改为 6 秒 | ✅ | chip 文案变为 `3秒 6秒 10秒 60秒`；点「6秒」→ `fixedSeconds=6`、该 chip `aria-pressed=true` |
| 非预设值无高亮 | ✅ | 点「6秒」后再点 `+` 一次 → `fixedSeconds=7`，**四个 chip 全部不高亮** |
| `interval_every_seconds` 删除 | ✅ | key 从 messages.json 移除（88 个 key），面板不再显示「每 N 秒刷新」（数字已在左侧） |

### 面板宽度恒定（ADR-025，第六轮）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| 基线宽度 | ✅ | 不人为设宽，`root.scrollWidth = 400`、`body.scrollWidth = 400` |
| 注入 500 字符 pageKey | ✅ | 仍为 400；该行 `scrollW 2268 / clientW 347` ⇒ 确实被省略号截断 |
| Header 状态行塞 40 遍长文案 | ✅ | 仍为 400 |
| 选择器输入框塞 300 字符 selector | ✅ | 仍为 400 |
| 注入 400 字符 URL（截图 `impl-v6-fixed-width.png`） | ✅ | 仍为 400，且 `title` 已挂（149 字符），悬浮可看全文 |
| 原生 tooltip 不影响布局 | ✅ | `title` 由浏览器绘制在页面之上，不参与布局计算 |

### restart 等待秒数（ADR-026，第七轮）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| 固定档无输入框 | ✅ | 开交互 + 选「重新开始」后，`input[name=interactionRestartWait]` **不存在**；显示 `按当前刷新间隔等待（6 秒）`（截图 `impl-v7-restart-fixed.png`） |
| 固定档用当前间隔 | ✅ | 单测：`fixedSeconds=6` + `interactionRestartWait=5` ⇒ `waitSeconds=6`（自定义值被忽略） |
| 随机档保留输入框 | ✅ | 切到「随机」后输入框出现，值为 6，标签 `重新开始前等待` 在场 |
| 随机档用自定义值 | ✅ | 单测：`intervalMode=random` + `interactionRestartWait=5` ⇒ `waitSeconds=5` |
| 脏数据防御 | ✅ | 负数夹到 0、小数四舍五入（`tests/restart-wait.test.ts`） |

### 交互触发范围 + 视觉分组 + 头部按钮（ADR-027，第八轮）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| 默认档 `outside-input` | ✅ | 默认 `ignoreInputField=true` ⇒ 状态行 `当前：输入框外的交互触发` |
| 开「仅输入框内」⇒ `inside-input-only` | ✅ | 状态行变 `当前：仅输入框内的交互触发`；存储 `inputOnly=true`（`ignoreInputField` 保留为 true） |
| 关「仅输入框内」⇒ 自动回原档 | ✅ | 状态行回到 `当前：输入框外的交互触发`（因为没动 `ignoreInputField`） |
| 开「忽略输入框交互」⇒ 真的切换 | ✅ | `interactionInputOnly` 被同时清掉，状态行变 `当前：输入框外的交互触发` |
| 两开关都不置灰 | ✅ | `ignoreDisabled=false`；任何时候都能直接切换 |
| 「刷新类型」与间隔粘成一组 | ✅ | 外层一张卡片 + 中间分隔线（截图 `impl-v8-fused-groups.png`） |
| 两个触发范围开关收进父卡片 | ✅ | `border-l-2` 缩进，视觉上从属于「用户交互时的刷新行为」 |
| 头部按钮位置固定 | ✅ | 未运行 `[开始]` / 运行中 `[暂停][停止]` / 已暂停 `[继续][停止]`，右侧始终在右 |
| 暂停态直接点「停止」 | ✅ | 点右侧按钮即停，变回 `[开始]`，不必先「继续」 |
| 单测覆盖 | ✅ | `tests/interaction-scope.test.ts` 16 例（三档组合 / 优先级 / 单向互斥 / restart 取值） |

### 三档触发范围 + flex 裁切修复（ADR-028，第九轮）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| 三档标签渲染 | ✅ | `[任何交互][仅框外][仅框内]`，默认选中「仅框外」 |
| 切档落库 | ✅ | 仅框内 ⇒ `{inputOnly:true, ignoreInput:true}`；任何交互 ⇒ `{false,false}`；仅框外 ⇒ `{false,true}` |
| 档位往返一致 | ✅ | 单测：每个 `scopePatch` 后再 `triggerScope` 读回，档位不变 |
| 三档互切不残留 | ✅ | 单测：`all → inside → all → outside` 每次都读回正确档位 |
| 老数据兼容 | ✅ | `{inputOnly:true, ignoreInput:true}` 读出 `inside-input-only`，无需迁移 |
| 刷新类型不再被裁 | ✅ | `fused h=138 / scrollHeight=136`（修复前 `h=96 / scrollHeight=136`） |
| XHR 交互组件可见 | ✅ | 「选择元素」「测试选择器」、selector 输入框、「触发方式」行 `inView` 全 true |
| 三个 section 无裁切 | ✅ | `sectionsClipped` 全为 `false`；`scrollHeight === clientHeight` |
| 滚动容器可滚动 | ✅ | 内容超高时 `scrollerScrollH(637) > clientHeight(518)`，容器滚动而非压扁子项 |

### 拾取器点击不穿透（ADR-030，第十一轮，v0.2.1）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| 选中手势不触发页面监听 | ✅ | 单测：`pointerdown→mousedown→pointerup→mouseup→click` 全序列后，页面监听计数 `[]`（全 0） |
| 真实浏览器验证 | ✅ | 本地测试页按钮挂 5 种事件计数器：拾取模式下点它 ⇒ `clicks=0 pointerdown=0 mousedown=0 pointerup=0 mouseup=0 click=0` |
| selector 仍正确落库 | ✅ | 同上实验后 `pageSelectors['http://127.0.0.1:45999/'] = {selector:'#btn', action:'single'}` |
| sweep 后拾取器退出 | ✅ | `isPickerActive() === false`，宿主节点已移除 |
| 退出后页面恢复正常 | ✅ | 同一元素再点一次 ⇒ 计数器 5/5 全部正常递增 |
| hover 阶段也不穿透 | ✅ | 未选中时 `click` 直接吞掉，页面计数 0 |
| 未命中元素不误确认 | ✅ | `elementFromPoint` 返回 null 时 `onPick` 未被调用，拾取器仍处于 hover |
| 400ms 兜底 | ✅ | 按下后不发 click 也会 `endSweep()` 收尾（避免监听永久残留） |

### 测试选择器高亮 + 图标倒计时（ADR-031，第十二轮，v0.3.0）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| 测试选择器自动滚动 | ✅ | 目标初始 `top=2248`（屏幕外）⇒ 触发后 `scrollY=1889`、`targetTop=359`、`inViewport=true` |
| 呼吸高亮出现并自动消失 | ✅ | MutationObserver 测到 `#ar-highlight-host` 存在 **2400ms** 后被移除（对应 3 次 × 800ms 动画） |
| 只高亮第一个命中 | ✅ | 多命中时标签显示「N 个命中（第 1 个）」，盒子只画在第一个元素上 |
| 未命中不动作 | ✅ | `not-found` / `invalid` 时不滚动、不高亮 |
| 图标显示秒级倒计时 | ✅ | 10s 间隔采样：`10 9 8 7 7 5 4 3 2 1 (空) 9 8 7` |
| `>=60s` 显示截断分钟 | ✅ | 120s ⇒ `1m 1m 1m 1m 1m 1m`；300s ⇒ `4m 4m 4m 4m`（首轮后剩 ~290s） |
| 未开启刷新时图标正常 | ✅ | 停止后徽章为 `''`（空串），不显示数字 |
| 暂停/失败态 | ✅ | 暂停 `II`、失败 `!`（单测覆盖，优先于倒计时） |
| 页面导航后不残留旧值 | ✅ | 预置 `TEST` 后 reload ⇒ 徽章被重设为倒计时值 |
| 单测覆盖 | ✅ | `tests/badge.test.ts` 14 例（秒数/分钟边界、截断、暂停/失败/wait、到期不为负） |

### 回归

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| T-30 回归 | ✅ | 改版后完整页面刷新仍工作：`refreshType='full'` 开启 2.5s 内 `count=1`、`lastError=null` |
## 5. DoD（完成的定义）

一次交付算完成，需要同时满足：

1. `07` 矩阵每条"用户要求"都有落点与至少一个 **P** 用例通过。
2. `07` §5 丢弃项 grep 检查全 0（`pnpm check:scope`）。
3. `08` 的偏离点（ADR-003/008/010）在验收记录里被显式确认（不是遗漏）——见本文件 §4.7。
4. 构建产物可 `load unpacked` 直接跑；manifest 无多余权限（`check:scope` 里的权限白名单已覆盖）。
5. `docs` 更新：README 变更记录 + `07` §5.1 落点表 + `09` §4.7 实测记录。

**当前状态：5/5 满足（第二轮后仍满足）。** 一键复验：`pnpm verify`。

## 6. 后续（不在本次范围）

- 多语言（加 `en`）——机制已就绪，只补 `messages.json`。
- 从 ARP 导入配置（ADR-012 明确不做，另立项）。
- 按站点作用域（ADR-002 明确不做）。
- 间隔的分/时预设（本扩展固定档只要秒级 3/6/10/60）。
- 跨 iframe 元素拾取（内容脚本 `allFrames:false`，见 `08` R13）。
- 发布流程（`pnpm zip` → Chrome Web Store）：本扩展的 `_locales` 与 manifest 已符合上传要求，
  但首次上架还需补商店素材（截图/描述/隐私声明）。