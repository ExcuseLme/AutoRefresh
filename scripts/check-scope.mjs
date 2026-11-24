/**
 * docs/07 §5 的「丢弃项 grep 检查」自动化版本（验收用例 T-50）。
 *
 * 规则：在 src/ + public/ + wxt.config.ts 中搜索被丢弃功能的特征字符串。
 * 注释行（`//`、`/*`、`*`）豁免 —— 设计文档里有"我们没有 X"这类说明是必要的。
 * 命中即失败，退出码 1。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCAN_DIRS = ['src', 'public'];
const SCAN_FILES = ['wxt.config.ts'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css']);

/** 被丢弃功能的特征串（对应 docs/07 §5 每一行） */
const FORBIDDEN = [
  // 独立配置页
  'autorefresh.io',
  'options_ui',
  'externally_connectable',
  // 自动启动 / 预定义
  'autostart',
  'asurl',
  'asrestart',
  'asrefresh',
  'rpttext',
  'pdcheck',
  'pdurl',
  'defaultpgtxt',
  // 倒计时
  'enableTimer',
  'countdownType',
  'countdownTime',
  'countdownDate',
  // 页面监控器
  'pmpattern',
  'checkme',
  'ignoreKeywords',
  'searchInPage',
  'areaSelector',
  'anyTimeDetection',
  'highlightKeyword',
  'windowFocusOnDetection',
  'monitorAlgorithm',
  // 自定义脚本
  'local:custom',
  // 热键
  'hotkey',
  '#shk',
  // 通知设置
  'pm_voice',
  'pmemail',
  'webhooks',
  'tabAlert',
  'pm_on_page_notification',
  'pm_notification_message',
  // AI
  'aiMonitor',
  '/v1/ai',
  // 付费 / 遥测
  'premium',
  'upgrade',
  'grace_period',
  'clientId',
  'analytics',
  'usage_counters',
  'extension_status',
  // 作用域隔离
  'domain_config',
  'site_scopes',
  'save_scope',
  'defaultSaveScope',
  // 侧边栏
  'side_panel',
  'sidePanel',
  // 页面内计时浮层
  'visualtimer',
  'showVisualTimer',
  'timerPosition',
  // 验证码 / 错误页检测
  'captchaDetection',
  'errorDetection',
  // 阻止系统睡眠
  'power_save',
  'requestKeepAwake',
  // ARP 的独有权限
  'unlimitedStorage',
  'contextMenus',
  'webRequest',
  // 注意：'notifications' 与 'cookies' 太常见（如 CSS 类名、注释），
  // 由下面 PERMISSION_CHECKS 在 manifest 上单独校验。
];

/** 必须在 manifest.json 里缺席的权限 */
const FORBIDDEN_PERMISSIONS = ['notifications', 'cookies', 'webRequest', 'sidePanel', 'power', 'unlimitedStorage', 'contextMenus'];

const hits = [];

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--');
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.output') continue;
      walk(full);
      continue;
    }
    if (!EXTS.has(extname(full))) continue;
    scanFile(full);
  }
}

function scanFile(file) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (const token of FORBIDDEN) {
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      if (line.includes(token)) {
        hits.push({ file: relative(ROOT, file), line: i + 1, token, text: line.trim().slice(0, 120) });
      }
    });
  }
}

for (const dir of SCAN_DIRS) walk(join(ROOT, dir));
for (const f of SCAN_FILES) scanFile(join(ROOT, f));

// manifest 权限校验（构建产物）
const manifestPath = join(ROOT, '.output', 'chrome-mv3', 'manifest.json');
let manifestPermissions = null;
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifestPermissions = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])];
} catch {
  console.warn('! 未找到构建产物 manifest.json，跳过权限校验（先跑 pnpm build）');
}

if (manifestPermissions) {
  for (const p of FORBIDDEN_PERMISSIONS) {
    if (manifestPermissions.includes(p)) {
      hits.push({ file: 'manifest.json', line: 0, token: `permission:${p}`, text: '被丢弃的权限仍在 manifest 中' });
    }
  }
  const extra = manifestPermissions.filter(
    (p) => !['tabs', 'storage', 'scripting', 'offscreen', 'alarms', '<all_urls>'].includes(p),
  );
  if (extra.length > 0) {
    hits.push({ file: 'manifest.json', line: 0, token: 'extra-permissions', text: `出现预期外的权限: ${extra.join(', ')}` });
  }
}

if (hits.length === 0) {
  console.log('✓ 丢弃项检查通过：0 命中（' + FORBIDDEN.length + ' 个特征串 + ' + FORBIDDEN_PERMISSIONS.length + ' 项权限）');
  process.exit(0);
}

console.error(`✗ 丢弃项检查失败：${hits.length} 处命中\n`);
for (const h of hits) {
  console.error(`  ${h.file}:${h.line}  [${h.token}]  ${h.text}`);
}
process.exit(1);
