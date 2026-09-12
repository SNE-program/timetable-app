/**
 * 构建前清理。存在的意义只有一个：**别让 APK 里堆进重复的旧主包**。
 *
 * 背景：v0.8.2 那个 APK 里躺着 274 个 web 资源文件（其中 50 份是同一个
 * index-*.js、100 份 web-*.js），解压后 19 MB，全是从没被清掉的历代构建残骸。
 * Capacitor 的 copy 只是往 android/app/src/main/assets/public 里叠加，
 * 并不会保证目标目录是干净的，所以每次 sync 之前自己清一下最稳。
 *
 * 注意：Windows 上删除偶尔会静默失败（文件被占用时 rmSync 既不报错也不删），
 * 所以这里删完必须 **回读确认**，确认不掉就退到 rmdir 再试一次，仍不行才报错。
 * 悄悄失败比直接报错危险得多 —— 它会让你以为打包干净了，其实没有。
 *
 *   node scripts/clean.mjs          只清 dist
 *   node scripts/clean.mjs android  只清 Android 侧的 web 资源
 *   node scripts/clean.mjs all      两个都清
 */
import { existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const targets = {
  dist: 'dist',
  android: 'android/app/src/main/assets/public',
};

const arg = process.argv[2] || 'dist';
const keys = arg === 'all' ? Object.keys(targets) : [arg];

for (const k of keys) {
  const rel = targets[k];
  if (!rel) {
    console.error('未知的清理目标: ' + k + '（可用: dist / android / all）');
    process.exit(1);
  }
  const abs = resolve(rel);
  if (!existsSync(abs)) {
    console.log('本就不存在 ' + rel);
    continue;
  }

  try { rmSync(abs, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (e) { /* 下面统一回读确认 */ }

  if (existsSync(abs) && process.platform === 'win32') {
    try { execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', abs], { stdio: 'ignore' }); } catch (e) { /* 再确认一次 */ }
  }

  if (existsSync(abs)) {
    console.error('清理失败：' + rel + ' 仍然存在（多半是文件被占用，关掉 dev server / 编辑器再试）');
    process.exit(1);
  }
  console.log('已清理 ' + rel);
}
