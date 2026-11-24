import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'public',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '__MSG_app_name__',
    description: '__MSG_app_description__',
    default_locale: 'zh_CN',
    version: '0.1.0',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    // 相对 ARP 削减：无 notifications / cookies / webRequest / sidePanel / power /
    // unlimitedStorage / contextMenus；offscreen 用于托管精确计时器（ADR-004）
    permissions: ['tabs', 'storage', 'scripting', 'offscreen', 'alarms'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '__MSG_app_name__',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      // 本扩展所有入口都在扩展内加载，不需要 module preload 的 polyfill（省 ~670B）
      modulePreload: { polyfill: false },
    },
  }),
});
