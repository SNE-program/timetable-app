#!/usr/bin/env node
/**
 * 生成 dist/latest.json —— 应用内「检查更新」看的那个文件。
 *
 * 为什么不直接查 GitHub API：未登录的 API 每个 IP 每小时只有 60 次，
 * 一个班几十号人挂在同一个校园网出口上，很容易一起被限流。
 * 放在自己的站点上，就是一个静态文件，没有限额、没有第三方。
 *
 * 版本号取自 package.json（与 build.gradle 由 npm run check:version 锁死一致），
 * 下载地址用 GitHub Releases 的固定名字 —— 那个地址永远指向最新一版。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repo = process.env.GITHUB_REPOSITORY
  ? 'https://github.com/' + process.env.GITHUB_REPOSITORY
  : (process.env.VITE_REPO_URL || '');
const dist = join(root, 'dist');
if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

const out = {
  version: pkg.version,
  publishedAt: new Date().toISOString(),
  apkUrl: repo ? repo + '/releases/latest/download/timetable-app.apk' : '',
  pageUrl: repo ? repo + '/releases/latest' : '',
  webUrl: 'https://timble.bond/',
};
writeFileSync(join(dist, 'latest.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('dist/latest.json → v' + out.version + (repo ? '' : '（没有仓库地址，apkUrl 留空：本地构建）'));
