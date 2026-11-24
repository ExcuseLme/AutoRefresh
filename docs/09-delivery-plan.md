# 09 · 交付计划与验收

## 1. 里程碑

> 每个里程碑结束时：`pnpm build` 通过、`pnpm test` 通过、`07` 的矩阵"落点"列已更新、`README` 变更记录加一行。

### M0 · 骨架（0.5 天）

- [ ] `wxt.config.ts`：manifest（权限 `tabs/storage/scripting/alarms/offscreen`、`host_permissions:["<all_urls>"]`、`default_locale:"zh_CN"`、content script `document_start`）
- [ ] Tailwind v4 接入 + `04` §6 的 token 写入 `:root` / `.dark`
- [ ] `src/lib/messages.ts` 类型全集；`src/lib/storage.ts` 的 `Options` + `DEFAULT_OPTIONS` + `migrate`
- [ ] `public/_locales/zh_CN/messages.json` 按 `06` §3 全量落盘
- [ ] 空 popup 能打开（无功能）

**DoD**：`load unpacked` 后点图标能弹出空白面板，控制台无错。

### M1 · 面板（1.5 天）

- [ ] `Header`（主按钮 + 状态摘要）
- [ ] `IntervalSection`（三模式分段 + 固定 4 chip + 自定义 chip + 随机两输入 + 自定义输入 + 校验）
- [ ] `RefreshTypeSection`（两段 + XHR 选择器输入）
- [ ] `OptionsSection`（折叠 + 6 行 + A3/A4 展开子内容）
- [ ] `NumberStepper` / `SegmentedControl` / `SwitchRow` / `Select`
- [ ] 所有改动手写 `OPTIONS_PATCH`（此时 SW 可先只做 echo）

**DoD**：面板与 `assets/reference/interval-fixed.png` 布局一致（截图对比见 §3）；改动后重开面板值保留。

### M2 · 引擎（2 天）

- [ ] `entrypoints/offscreen`：`ARM/DISARM/PING`、`TICK_DONE`、`TICK_PROGRESS`
- [ ] `background.ts`：`sessionStore`（含 `storage.session` 镜像）、`START/STOP/PAUSE/RESUME`、token 校验、60s `PING`、`alarms` 兜底、SW 重启恢复
- [ ] `lib/interval.ts`：`nextDelayMs`（含 `avoidRepeatRandom`）+ `clampSeconds`
- [ ] `lib/refresh.ts`：完整刷新分支（keep-active 续期 → 重定向 → reload/update+reload）、计数、上限
- [ ] badge（若 OQ-4 采纳）

**DoD**：`09` §4 的 T-10 ~ T-14、T-20 ~ T-24、T-30、T-40 通过。

### M3 · 内容脚本（1 天）

- [ ] `content.ts`：交互上报（click 捕获 + keydown，`isTrusted` + `activeElement` 判输入框）
- [ ] keep-active：MAIN world 补丁注入 + `sessionStorage` TTL 自愈 + 45s 伪活动 + `autoDiscardable`
- [ ] XHR：`AUTOCLICK` 消息 + `querySelector` + 失败记录
- [ ] `lib/interaction.ts`：SW 侧决策（A4/A6/A7）

**DoD**：T-11、T-13、T-15、T-16、T-31 通过。

### M4 · 收口（0.5 天）

- [ ] 清理：全仓 grep 丢弃项（`07` §5 的检查表）0 命中
- [ ] `vitest` 用例补齐（`05` §9）
- [ ] 中文文案通读（`06` §3）与面板实际渲染一致
- [ ] 构建产物体积检查（§5）

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

| 参考图 | 对比点 |
| --- | --- |
| `docs/assets/reference/interval-fixed.png` | 三段分段控件、大号数字、chip 行、选项卡片行高/图标尺寸 |
| `docs/assets/reference/interval-random.png` | 双输入框并排、摘要行 |
| `docs/assets/reference/interval-custom.png` | 单输入框 |
| `docs/assets/reference/options-interaction-expanded.png` | 展开态三按钮（停止=红框红字）与虚线外框 |
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
| T-20 | 固定档点 3/5/10/60 四个 chip | 选中态正确，`fixedSeconds` 落库，摘要显示对应秒数 | P |
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
| T-31 | XHR 刷新 + 选择器指向"加载更多"按钮 | 每轮该按钮被点击，页面不整页重载 | P |
| T-31b | XHR 刷新 + 选择器为空 | 不重载、不报错；状态摘要提示"需要先设置选择器" | P |
| T-31c | XHR 刷新 + 选择器无效（`#nope`） | 不报错崩溃；`lastError` 记录 | S |
| T-32 | 检查"刷新类型"所在位置 | 在"间隔"段落内（间隔之后、选项之前），且不存在"监控"tab | P |

### §4.5 鲁棒性

| ID | 用例 | 预期 | P/S |
| --- | --- | --- | --- |
| T-40 | 运行中在 `chrome://serviceworker-internals` 手动 Stop 扩展的 SW | 下一轮仍按时执行（offscreen 不受影响） | P |
| T-41 | 运行中关闭 offscreen（DevTools 关闭其页面） | 60s 内被探活重建，刷新恢复 | S |
| T-42 | 运行中关闭该 tab | 会话清除、定时器 DISARM、无报错 | P |
| T-43 | 运行中浏览器重启 | 不自动恢复刷新（ADR/`03` §4 的决策），面板显示"未运行" | P |
| T-44 | 在 `chrome://settings`、`about:blank` 上点"开始" | 明确提示"此页面无法自动刷新"，不建会话 | P |
| T-45 | 会话中把间隔改成 0.1s 并运行 30s | 不崩溃、不卡死；页面被频繁刷新（符合配置） | S |
| T-46 | 同时运行 ARP 与本扩展 | 两者互不干扰（键名前缀差异），本扩展功能正常 | S |

### §4.6 清理检查

| ID | 用例 | 预期 | P/S |
| --- | --- | --- | --- |
| T-50 | `07` §5 的所有 grep 检查 | 全部 0 命中 | P |
| T-51 | `vitest` 全绿 | — | P |
| T-52 | 构建产物 `dist/` 体积 | < 300KB（不含 sourcemap） | S |
| T-53 | 无任何网络请求（DevTools 全局观察 5 分钟） | 除页面自身请求外，扩展自身 0 请求 | P |

## 5. DoD（完成的定义）

一次交付算完成，需要同时满足：

1. `07` 矩阵每条"用户要求"都有落点与至少一个 **P** 用例通过。
2. `07` §5 丢弃项 grep 检查全 0。
3. `08` 的偏离点（ADR-003/008/010）在验收记录里被显式确认（不是遗漏）。
4. 构建产物可 `load unpacked` 直接跑；manifest 无多余权限。
5. `docs` 更新：README 变更记录 + `07` 落点列。

## 6. 后续（不在本次范围）

- 多语言（加 `en`）——机制已就绪，只补 `messages.json`。
- 从 ARP 导入配置（ADR-012 明确不做，另立项）。
- 按站点作用域（ADR-002 明确不做）。
- 间隔的分/时预设（本扩展固定档只要秒级 3/5/10/60）。
