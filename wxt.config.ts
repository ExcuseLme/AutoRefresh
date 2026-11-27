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
    // 版本号**只在这里之外维护**：单一真源是 package.json，WXT 自动读取。
    // 不要在此硬写 version —— 两处各写一份必然漂移（ADR-029）。
    // 公钥：固定扩展 ID（与工程所在路径脱钩）。
    // 私钥在同级密钥库 D:\data\chrome-ext-secret-keys\AutoRefresh.pem，绝不入库。
    // 扩展 ID = dfiecgpgeeafbclbbgbpnidcgeoifmje
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzEbOGxgUcxSqrYOgl8NKKj7n0QiUg4l3+HFmrzDFASz5E8gv77GeaJ86MgWux3HiuQmZrYgZw+izNYNZCRS17rAahBNjNN8zcTtUwtUf8/xenB9JSCM31+C/p0Cpsg40VUAGs17JWAc/b+gFMGZvAVrSC55Tu0p9MClKAEeIxlbuYLU+ziCYtWOgNFeHMNe0sdyQlZ8NNyHSqWOo4mTEldfRL6rUH4IiQQFhhNfxiWqX1QqN8xYGsvTmhrDnbjiqaePb9AzJaWiBwKhjqVzYoyTu8hKK534g5JydUv1KNJmI+oDK4htZOnhjON+6irELRbCuuYLqxq3vzaqI4OP8iwIDAQAB',
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
