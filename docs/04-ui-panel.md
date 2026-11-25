# 04 · 扩展面板（popup）设计

> 形态已确认：**单屏滚动面板**（Q3）。没有 tab 切换，从顶到底一条流。
> 证据：`assets/reference/popup-wide-idle.png`（ARP 原生 480px 面板全貌）、
> `interval-fixed.png` / `interval-random.png` / `interval-custom.png`（三档间隔）、
> `options-interaction-expanded.png`（交互展开态）、`options-redirection-menu.png`（下拉）、
> `monitor-refresh-type.png`（刷新类型分段控件）。

## 1. 尺寸与骨架

- `min-width: 480px`（继承 ARP 的 `body,#root{min-width:480px}`），高度跟随内容，最大 600px 后内部滚动。
- 布局：`flex flex-col`，仅中间内容区 `overflow-y:auto`，头部与底部操作区固定。

```
┌──────────────────────────────────────────────┐
│ [icon] AutoRefresh            [▶ 开始 / ■ 停止] │  头部：品牌 + 主操作
│        状态：运行中 · 第 3/10 次 · 下次 8s       │        + 状态摘要（一行）
├──────────────────────────────────────────────┤
│  ⟳ 间隔                                        │  段落 1：间隔
│  ┌──────────────┬──────────────┐              │
│  │   固定 (on)   │     随机      │              │  分段控件（**2 段**，ADR-021）
│  └──────────────┴──────────────┘              │
│  [ − ] [ 10 ] [ + ] 秒      [3s][6s][10s][60s] │  一行：数字 + 快捷 chip（ADR-024）
│  ── 或 ──                                      │
│  最小 [ 5 ]  最大 [ 30 ]  秒                    │  随机档：两个数字输入 + 摘要
├──────────────────────────────────────────────┤
│  ⚡ 刷新类型                                     │  段落 2：刷新类型（从「监控」搬来）
│  ┌────────────┬────────────┐                  │
│  │ 完整页面刷新 │  XHR 刷新   │                  │  分段控件（2 段）
│  └────────────┴────────────┘                  │
│  自动点击元素选择器      [选择元素] [测试选择器]   │  仅 XHR 时展开
│  [ [aria-label="刷新"] .................... ]    │
│  触发方式                                       │
│  ┌────────────┬────────────┐                  │  **单击 / 双击**（ADR-020）
│  │   单击(on)  │    双击     │                  │
│  └────────────┴────────────┘                  │
├──────────────────────────────────────────────┤
│  ⚙ 选项                                    ⌃  │  段落 3：可折叠
│  ⚡ 强制刷新                         [switch]   │
│  🗔 让页面在后台保持活动              [switch]   │
│  # 设置刷新次数                    [switch]     │
│    └ 次数 [ 10 ]                               │  开启后展开
│  👆 用户交互时的刷新行为            [switch]    │
│    └ [停止][暂停][重新开始]                     │  开启后展开（分段按钮）
│      重新开始前等待 [ 5 ] 秒                     │  仅 restart 展开
│  ⌨ 忽略输入框交互                    [switch]   │  （仅交互开启时展示，见 §4.3）
│  ➤ 重定向行为              [跟随所有重定向 ▾]   │
└──────────────────────────────────────────────┘
```

## 2. 头部（Header）

| 元素 | 内容 | 行为 |
| --- | --- | --- |
| 图标 + 名称 + 版本 | `AutoRefresh` + `v0.3.0` | 版本号是 `chrome.runtime.getManifest().version`（ADR-029），用来判断扩展是否重载成功。**与 ARP 的差异**：ARP 那行是发布信息（`v9.3.0 / Updated`），本扩展只显示版本号，不带更新日期 |
| 主按钮 | `▶ 开始` / `■ 停止`（进行中）/ `❚❚ 暂停`（可加次级按钮） | 见 §3 |
| 状态摘要 | `未运行` / `运行中 · 第 3/10 次` / `已暂停` / `每 8s 后刷新`（OQ-2 待定：是否显示倒计时数字） | 只读 |

- 图标与按钮沿用 ARP 的绿色主色（`--primary: oklch(62% .17 155)`，见 §6）。
- 按钮状态映射：
  - `stop` → 主按钮「开始」（绿色）
  - `start` → 主按钮「停止」（红色 destructive）+ 一个「暂停」次级按钮
  - `pause` → 主按钮「继续」（绿色）+ 「停止」次级
  - `wait`（交互 restart 中）→ 主按钮「停止」+ 摘要「等待 5s 后重启」

## 2.1 头部按钮语义（ADR-027）

三个按钮的位置与职责**固定**，不随状态互换内容：

| 状态 | 左侧副按钮 | 右侧主按钮 |
| --- | --- | --- |
| 未运行 | （不渲染） | **开始** |
| 运行中 | **暂停** | **停止** |
| 已暂停 | **继续** | **停止** |

- 右侧永远是「开始」或「停止」二选一（`active = session !== null`）
- 左侧只会在开始之后出现，只可能是「暂停」或「继续」
- 暂停态点右侧「停止」也能直接停，不必先「继续」

旧实现会让按钮内容互换（点暂停后左侧变「停止」、右侧变「继续」），导致「停止」可能在左也可能在右。
### 2.2 扩展图标（action badge，ADR-031）

| 会话状态 | 徽章内容 | 底色 |
| --- | --- | --- |
| 无会话（未开启刷新） | **空**（正常图标，不显示数字） | 绿 |
| 运行中 / 等待重启 | **倒计时数字**：`>=60s` 显示截断分钟数（`1m`/`2m`/`4m`…），否则秒数 | 绿 |
| 已暂停 | `II` | 黄 |
| 最近一轮失败 | `!` | 红 |
| 拾取元素中 | `⊕`（此时暂停倒计时刷新，避免被覆盖） | 紫 |

- 秒级跳动的驱动方：offscreen 每秒发 `BADGE_TICK`，SW 收到后 `chrome.action` 写徽章。
  **不能**让 offscreen 自己写 —— offscreen 文档里没有 `chrome.action` API（实测抛异常）。
- `>=60s` 用**截断**而非四舍五入：240–299s 全是 `4m`，到 300s 才跳 `5m`。
- 剩余秒用 `Math.ceil`，避免最后一秒"显示 0 但还没刷新"。

## 3. 主操作语义（对齐 ARP 的 Rx / mS / gS / $b）

| 动作 | 前置 | 效果 |
| --- | --- | --- |
| `START` | 当前 tab 是 http/https（`chrome://`、`about:blank`、`file://` 拒绝，ARP `ax` 同款判断） | 清旧会话 → 建新会话（count=0）→ 若 `refreshLimitEnabled` 用 `refreshLimitCount` → **首轮是否立即刷新**：本扩展采用"立即刷一轮，再进入等待"（因为已无监控，"先扫后等"没有意义）→ 见 ADR-008 |
| `STOP` | 任意 | 清会话、`DISARM`、关掉 keep-active 注入、恢复 UI |
| `PAUSE` | `start`/`wait` | 暂停且保留 count；offscreen `DISARM` |
| `RESUME` | `pause` | 恢复并重新 `ARM`（delay 从头算，与 ARP `gS` 一致） |

## 4. 各段落细节

### 4.1 间隔段落

- **分段控件**（`IntervalMode`）：**固定 / 随机**两段（ADR-021 起没有「自定义」）。
  选中态为白底（照 ARP：`interval-fixed.png`）。
  切换模式**立即落库**（`intervalMode`），不影响正在运行的会话是否重启 ——
  运行中改间隔：只影响**下一轮**的等待时间（ARP 的 `Hx` 在 `optionsChange` 时会重算，见 `05` §4.4）。
- **固定档：只有一个数字输入框**（ADR-021）。它是固定档**唯一的数据来源**：

  | 用户操作 | 行为 | 落库字段 |
  | --- | --- | --- |
  | 点 `−` / `+` | 对当前数字 `∓1`（到 1 / 86400 为止） | `fixedSeconds` |
  | 点预设 chip `3秒/6秒/10秒/60秒` | 把该数字**上屏**到输入框 | `fixedSeconds` |
  | 点数字直接输入，回车或失焦 | 直接改这个数字；非法（小数/越界）回滚显示，不落库 | `fixedSeconds` |

  - **chip 与数字输入同一行**（ADR-024）：`− [10] + 秒` 在左，4 个 chip 靠右（`ml-auto`），
    卡片只有一行。stepper 限宽 128px，chip 总宽约 165px，400px 面板下刚好铺满不溢出。
  - chip 高亮是**纯值匹配**（`fixedSeconds === preset`）：输入 13 时没有 chip 高亮，这是正确的。
    不再有「命中预设 / 未命中 ⇒ 显示自定义 chip」的消歧。
  - 数字输入：`input[type=number]` + 自绘 −/+ 按钮，居中大号数字（照 ARP 的 `interval-fixed.png`），
    去掉 spinner（`appearance:none`，ARP 用 `no-spinner` 类）。

- **随机档**：两个数字输入「最小(秒)」「最大(秒)」，下方一行摘要
  `每 5–30 秒刷新`；非法（max<min）时把摘要替换成红色提示。
  ARP 的警告文案键 `warning_random_interval` 在本扩展用自写文案（见 `06`）。

> **ADR-021 删掉的东西**（都是用户实测后要求去掉的）：
> 「自定义」分段、`✎ 自定义` chip、chip 触发的行内第二个数字输入框、
> 以及 `customOpen` 这个本地状态（它是"改个数字要切 tab"的根源）。

### 4.2 刷新类型段落（原「监控」tab 的刷新类型）

- 两段分段控件：`完整页面刷新` / `XHR 刷新`，下方一行说明随选中项变化：
  - `完整页面刷新`：`重新加载整个页面`
  - `XHR 刷新`：`不重新加载页面，点击指定元素以触发页面自身的请求`
- XHR 选中时展开两块内容：

  **① 自动点击元素选择器**（`placeholder="例如 #refresh-btn 或 .load-more"`）
  - **ADR-022：输入框读写的是"当前标签页这个 URL"的记录**，不是全局值。
    下方常驻一行 `仅对当前页面生效：https://…`，让隔离这件事可见。
    若运行中的会话属于另一个页面，再显示一条提示"改这里不会影响它"。
  - 标题右侧两个按钮，语义不同：
    | 按钮 | 作用 |
    | --- | --- |
    | `选择元素` | 进入页内拾取模式（ADR-018）。点一下页面元素即自动生成并回填 selector |
    | `测试选择器` | 只读回显：`命中 N 个元素：<div> “刷新”` / `没有匹配到元素` / `选择器语法无效` |
  - 拾取中按钮文案变 `选择中…`；用户去页面点选时 popup 会被关闭（浏览器行为），
    结果由 SW 落库并尽力 `chrome.action.openPopup()` 重新打开面板，徽章闪 `✓`。
  - 运行时用 `document.querySelector` 校验；无效时该轮不计次数、红字告警（`05` §7.3）。
  - **去掉 ARP 的 premium 皇冠**（原控件右上角有 `高级版` 标签，见 `monitor-refresh-type.png`）。

  **② 触发方式**：`单击` / `双击` 两段（ADR-020）
  - 双击 = 两次完整按下序列 + `dblclick`，`click.detail` 依次 1、2 ——
    适合"双击页面内子 tab 才触发局部刷新"的页面。
  - 下方一行说明随选项变化（`click_single_desc` / `click_double_desc`）。
  - 该分段只在 `refreshType === 'xhr'` 时出现（整页刷新没有"点哪儿"的问题）。

### 4.3 选项段落（可折叠，默认展开；记住折叠状态）

| 行 | 标题 | 副标题 | 控件 | 展开内容 |
| --- | --- | --- | --- | --- |
| A1 | 强制刷新 | 每次重新加载时绕过缓存 | switch | — |
| A2 | 让页面在后台保持活动 | 适用于标签页在后台时会退出登录的网站 | switch | — |
| A3 | 设置刷新次数 | 达到指定次数后停止 | switch | 次数数字输入（≥1，整数） |
| A4/A7 | 用户交互时的刷新行为 | 使用页面时的行为 | switch | 三选一按钮组：停止 / 暂停 / 重新开始（照 `options-interaction-expanded.png` 的红色「停止」+「暂停」+「重新开始」）；`restart` 时展开等待说明：**固定档**只显示只读提示 `按当前刷新间隔等待（N 秒）`（不渲染输入框，ADR-026）；**随机档**才给「重新开始前等待 [N] 秒」输入框 |
| A6 | 忽略输入框交互 | 在输入框内点击或打字也继续刷新 | switch | — |
| A5 | 重定向行为 | 刷新期间处理重定向 | 下拉（`跟随所有重定向` / `跟随规范 URL`） | 下拉说明文案随选项变化 |

- **A6 与 A4 的耦合**：`interactions=false` 时 A6 无意义 ⇒ 置灰但保留值（ARP 也是保留值、只是不生效）。
- 折叠头：`⚙ 选项` + 右侧 chevron，折叠状态存 `localStorage`（**不进 `options`**，
  因为这是纯 UI 偏好，不该触发 `storage.onChanged` 的配置广播）。
- 与 ARP 视觉对齐：每行是 "图标 + 标题/副标题 + 右侧控件" 的卡片，图标为浅灰圆角方块（见 `interval-fixed.png`）。

### 4.3.1 交互的三个触发范围档（ADR-028）

「用户交互时的刷新行为」开启后，卡片内先给出动作三选一（停止/暂停/重新开始），
下面是一个缩进的「触发范围」子块（`border-l-2` + `pl-2`，视觉上明确从属于父项）。

**用三段互斥的 SegmentedControl（ADR-028），不是两个开关**：

```
触发范围   [ 任何交互 ][ 仅框外 ][ 仅框内 ]
           点击、打字、滚动都会触发 / 输入框外的点击…
```

| 档位 | 含义 | 存储映射 |
| --- | --- | --- |
| `all` | 任何交互都触发 | `{inputOnly:false, ignoreInput:false}` |
| `outside-input` | 只有输入框外的交互触发（**默认**） | `{inputOnly:false, ignoreInput:true}` |
| `inside-input-only` | 只有输入框内的点击/打字触发，滚动与普通点击不影响刷新 | `{inputOnly:true}` |

**为什么放弃"两个开关"方案**（这是 ADR-027 → ADR-028 的修正）：

2 个布尔 = 4 种组合，但只有 3 种合法，`{inputOnly:true, ignoreInput:true}` 是冗余非法态。
ADR-027 用三种补丁去掩盖它（优先级判定 / 强制关另一个 / 置灰），每种都有副作用：
- 优先级：数据里留着非法组合，只是行为被盖住
- 强制关另一个：丢掉"回到原来那一档"的能力
- 置灰：切档必须先卸载另一个，多一步

改成枚举后：互斥天然成立、没有非法态、不需要优先级、不需要"记住上一档"。
**不改 schema**（仍是两个布尔字段，由 `scopePatch` / `triggerScope` 双向映射）。

不做成折叠子树 —— 用户明确说"这样会导致多出一个展开/折叠操作，将操作复杂化了"。
### 4.4 不做（但 ARP 有）的行

- 防止重新提交表单（premium，`options-interaction-*` 截图中间那行）—— OQ-3
- 显示可视计时器 —— 丢弃（与"不要倒计时"一致）
- 验证码检测 / 错误页检测 —— 丢弃
- 侧边栏开关、通知铃铛、账户菜单、AI 浮球、升级入口 —— 丢弃

## 5. 交互与无障碍

- 所有 switch 用 `role="switch"` + `aria-checked` + `aria-label`（ARP 已如此，`take_snapshot` 可见）。
- 分段控件用 `role="tablist"` / `role="tab"` + `aria-selected`。
- 所有输入有 `aria-label`（如「以秒为单位的间隔」「最小秒数」「最大秒数」）。
- 数字输入的 −/+ 按钮 `aria-label`：`减少 1` / `增加 1`。
- 键盘：面板内 `Tab` 顺序 = 视觉顺序；`Enter` 在输入框内提交并失焦。
- 文案随 `i18n`（仅中文，见 `06`）。

## 6. 视觉 token（从 ARP 的 `assets/popup-DcUX7WOF.css` 提取，可直接用）

亮色（`:root`）：

```
--radius: .625rem;
--background: oklch(97% 0 0);
--foreground: oklch(15% 0 0);
--card: oklch(100% 0 0);
--primary: oklch(62% .17 155);
--primary-foreground: oklch(100% 0 0);
--secondary: oklch(94% 0 0);
--muted-foreground: oklch(50% 0 0);
--destructive: oklch(55% .22 27);
--border: oklch(88% 0 0);
--ring: oklch(62% .17 155);
```

暗色（`.dark`）：

```
--background: oklch(15.5% .004 240);
--card: oklch(19.5% .004 240);
--primary: oklch(64% .16 155);
--border: oklch(30% .004 240);
--muted-foreground: oklch(62% .004 240);
```

字体：`Inter, sans-serif`（`--default-font-family`），等宽 `--default-mono-font-family`；
数字一律 `font-variant-numeric: tabular-nums`（避免倒计时/间隔数字抖动）。

其他细节：

- 卡片：`rounded-xl border bg-card`，hover 边框加深一级（照 ARP 的 `hover:border-zinc-300`）。
- 分段控件外壳：`rounded-xl bg-secondary p-1`，选中项 `bg-card shadow-sm`。
- 预设 chip：`rounded-full border px-3 py-1 font-mono text-xs`，选中 `bg-emerald-50 border-emerald-300 text-emerald-700`。
- 危险/停止按钮：`bg-rose-50 text-rose-600 border-rose-200`（照 `options-interaction-expanded.png`）。

## 7. 面板宽度对照

ARP 的面板有 `min-width:480px` 且内部还有一层 `overflow-y-scroll` 容器
（`flex flex-1 flex-col gap-4 overflow-y-scroll bg-zinc-50 px-4`）。
**ADR-023（紧凑改版）起不再沿用**：宽度从 480px 收到 **400px**，
内容区 `gap` 从 16px 收到 **8px**，卡片内边距从 12–16px 收到 **6–10px**，
字号主档从 14px 收到 **12–12.5px**、辅助文字 11px → **10.5px**。

用户明确反馈："原扩展这个布局风格过于松散，边距巨大，我极其厌恶这种浪费空间的宽松布局"。
所以本扩展的视觉基线**不再对齐 ARP 截图**，而是以"信息密度优先"为准（但仍保留必要的
换行与一点边距，不做强行挤压）。详见 `08` ADR-023。

### 7.1 宽度恒定（ADR-025）

面板宽度**写死 400px**，不随内容变化：

```css
body, #root {
  width: 400px; min-width: 400px; max-width: 400px;
  overflow-x: hidden;
}
```

三个属性必须一起写：Chrome popup 的宽度按内容自动计算，只写 `min-width` 时**没有上限**，
任何一行超长文本都会把面板顶宽 —— 这正是"长 URL 页面上面板更宽、切页面时宽度来回跳"的原因。

超长文本一律 `truncate` + `title`：
`仅对当前页面生效：<pageKey>`、会话属于别的页面提示、选择器探测结果。
`title` 是浏览器**原生 tooltip**，在页面之上绘制，不参与布局、不影响宽度。

## 8. 组件清单（实现时的文件对应）

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| `App` | `entrypoints/popup/App.tsx` | 拉 `options` + `session`，分发 `OPTIONS_PATCH` / `PICKER_START` |
| `Header` | `components/Header.tsx` | 主按钮、状态摘要、失败红字 |
| `IntervalSection` | `components/IntervalSection.tsx` | 两段模式 + **单一**数字输入 + 4 个快捷 chip + 随机区间 |
| `RefreshTypeSection` | `components/RefreshTypeSection.tsx` | 刷新类型 + 选择器（含「选择元素」/「测试选择器」）+ 单击/双击 |
| `OptionsSection` | `components/OptionsSection.tsx` | 折叠容器 + 6 行开关 |
| `SegmentedControl` | `components/ui/index.tsx` | 通用分段控件（`role=tablist`） |
| `NumberStepper` | `components/ui/index.tsx` | 居中大数字 + −/+ + 严格整数校验 |
| `SwitchRow` / `Switch` / `Select` | `components/ui/index.tsx` | 开关行 / 开关 / 下拉 |
| 拾取器覆盖层 | `lib/picker.ts` | 页内 shadow DOM 覆盖层、捕获阶段监听、Esc/右键取消（ADR-018） |
| 选择器生成器 | `lib/selector.ts` | 5 层降级 + 稳定性启发式 + 唯一性判定 + 最小化（ADR-019） |
| 点击序列 | `lib/dom-click.ts` | 完整 pointer/mouse 序列；单击 / 双击（ADR-015 / ADR-020） |
