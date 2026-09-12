import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

/**
 * 项目主页地址。
 *
 * GitHub Actions 会把仓库名放在 GITHUB_REPOSITORY 里（owner/repo），本地构建没有，
 * 于是本地产物里这个值为空 —— 界面上"去下载 Android 版"的入口会自己消失，
 * 不会出现一个打不开的死链。想本地也带上，就设 VITE_REPO_URL。
 */
const repoUrl = process.env.GITHUB_REPOSITORY
  ? 'https://github.com/' + process.env.GITHUB_REPOSITORY
  : (process.env.VITE_REPO_URL || '');

export default defineConfig({
  plugins: [react()],
  /* 构建时间戳：打进包里，用来确认手机上跑的到底是哪一版 */
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __REPO_URL__: JSON.stringify(repoUrl),
    /*
     * 云备份（可选）：为空时前端整块功能不出现，应用保持"完全离线"。
     * anon key 是公开的（数据安全靠数据库的 RLS），service_role key 绝不能出现在这里。
     */
    __SUPABASE_URL__: JSON.stringify(process.env.VITE_SUPABASE_URL || ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY || ''),
  },
  server: { host: '127.0.0.1', port: 5273, strictPort: true },
  /*
   * 相对路径。
   *
   * GitHub Pages 的项目页地址是 https://<user>.github.io/<repo>/ —— 绝对路径 /assets/…
   * 会指到域名根目录去，整站白屏。相对路径在子路径下、在 Capacitor 的
   * https://localhost/ 下都对，所以两边共用一个构建产物。
   */
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    /* 显式要求清空输出目录 —— 之前分块一路堆积到 271 个文件 */
    emptyOutDir: true,
    /* 不生成 modulepreload —— 它在 Capacitor WebView 里可能永不触发 load/error */
    modulePreload: false,
    rollupOptions: { output: { manualChunks: undefined } },
  },
});
