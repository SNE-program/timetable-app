#!/usr/bin/env node
/**
 * 生成 dist/latest.json —— 应用内「检查更新」看的那个文件。
 *
 * ## 为什么不用 GitHub API 查版本
 *
 * 未登录的 API 每个 IP 每小时只有 60 次，一个班几十号人挂在同一个校园网出口上，
 * 很容易一起被限流。放在自己的站点上就是一个静态文件：没有限额、没有第三方。
 *
 * ## 安装包放哪（这是踩过坑的地方）
 *
 * 第一版把下载地址指向 GitHub Releases —— 结果在国内网络里点「下载并安装」
 * 直接 failed to connect：github.com 与 *.githubusercontent.com 在校园网里经常连不上。
 * 现在**主地址是 Supabase Storage 的公开桶**（走 Cloudflare，能登录云备份就说明它通），
 * GitHub 那份降级成备选（apkAlt），插件会依次尝试。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repo = process.env.GITHUB_REPOSITORY
  ? 'https://github.com/' + process.env.GITHUB_REPOSITORY
  : (process.env.VITE_REPO_URL || '');
const supabase = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const dist = join(root, 'dist');
if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

const supabaseApk = supabase ? supabase + '/storage/v1/object/public/app/timetable-app.apk' : '';
const out = {
  version: pkg.version,
  publishedAt: new Date().toISOString(),
  /* 主地址：先试它 */
  apkUrl: supabaseApk || (repo ? repo + '/releases/latest/download/timetable-app.apk' : ''),
  /* 备选：主地址连不上时再试 */
  apkAlt: repo ? repo + '/releases/latest/download/timetable-app.apk' : '',
  pageUrl: repo ? repo + '/releases/latest' : '',
  webUrl: 'https://timble.bond/',
};
writeFileSync(join(dist, 'latest.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('dist/latest.json → v' + out.version);
console.log('  主地址: ' + (out.apkUrl || '(空)'));
console.log('  备选:   ' + (out.apkAlt || '(空)'));
