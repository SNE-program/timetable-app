#!/usr/bin/env node
/**
 * 用 GitHub API 把当前分支推上去（等价于 git push，但走 api.github.com）。
 *
 * 为什么需要它：某些网络下 github.com:443 会被连接重置，而 api.github.com 正常 ——
 * 这时 git push 会直接失败，但 Git Data API 仍然可用。
 *
 * 用法：
 *   $env:GITHUB_TOKEN = 'ghp_...'   # 只需 repo 权限；用完记得撤销
 *   node scripts/push-via-api.mjs
 *
 * 它做的事：读本地 HEAD 的对象（git cat-file，不用工作区）→ 逐个上传 blob →
 * 建 tree → 建 commit → 把远端分支指过去。每个 blob 的 SHA 都要求与本地相同，
 * tree 与 commit 的 SHA 也要求与本地相同 —— 不相等就报错停下，不做「看起来成功了」的推送。
 * 令牌只从环境变量读，任何情况下都不写进仓库。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
if (!token) {
  console.error('缺少令牌：先设置 GITHUB_TOKEN（只需 repo 权限），用完请撤销。');
  process.exit(1);
}

function git(args, input) {
  const r = spawnSync('git', args, { cwd: REPO_DIR, input: input, maxBuffer: 1024 * 1024 * 256 });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' 失败: ' + String(r.stderr).slice(0, 300));
  return r.stdout;
}
function gitText(args) { return git(args).toString('utf8').trim(); }

function object(sha) {
  const out = git(['cat-file', '--batch'], sha + '\n');
  const nl = out.indexOf(10);
  const head = out.slice(0, nl).toString('utf8').split(' ');
  const size = Number(head[2]);
  return { type: head[1], body: out.slice(nl + 1, nl + 1 + size) };
}

function walkTree(sha, prefix, out) {
  const t = object(sha);
  let i = 0;
  while (i < t.body.length) {
    const nul = t.body.indexOf(0, i);
    const head = t.body.slice(i, nul).toString('utf8');
    const sp = head.indexOf(' ');
    const mode = head.slice(0, sp);
    const name = head.slice(sp + 1);
    const obj = t.body.slice(nul + 1, nul + 21).toString('hex');
    i = nul + 21;
    if (mode === '40000' || mode === '040000') walkTree(obj, prefix + name + '/', out);
    else out.push({ path: prefix + name, mode: mode, sha: obj });
  }
  return out;
}

const remoteUrl = process.env.PUSH_REMOTE || (function () {
  try { return gitText(['remote', 'get-url', 'origin']); } catch (e) { return ''; }
})();
const parsed = /github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl);
if (!parsed) { console.error('解析不出 GitHub 仓库地址：' + remoteUrl + '（可用 PUSH_REMOTE 指定）'); process.exit(1); }
const OWNER = process.env.GH_OWNER || parsed[1];
const REPO = process.env.GH_REPO || parsed[2];
const BRANCH = process.env.PUSH_BRANCH || gitText(['rev-parse', '--abbrev-ref', 'HEAD']);
const API = 'https://api.github.com';
const HEADERS = {
  Authorization: 'Bearer ' + token,
  'User-Agent': 'push-via-api',
  'X-GitHub-Api-Version': '2022-11-28',
  Accept: 'application/vnd.github+json',
};

async function api(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(API + path, {
      method: method,
      headers: body ? Object.assign({ 'Content-Type': 'application/json' }, HEADERS) : HEADERS,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.status === 204 ? null : await res.json();
    const text = await res.text();
    if ([403, 429, 500, 502, 503, 504].includes(res.status) && attempt < 4) {
      await new Promise(function (r) { setTimeout(r, 1500 * (attempt + 1)); });
      continue;
    }
    throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + text.slice(0, 300));
  }
  throw new Error('重试次数用完');
}

function ident(line) {
  const m = /^(.*) <(.*)> (\d+) ([+-])(\d{2})(\d{2})$/.exec(line);
  const offMin = (m[4] === '-' ? -1 : 1) * (Number(m[5]) * 60 + Number(m[6]));
  const iso = new Date((Number(m[3]) + offMin * 60) * 1000).toISOString().replace(/\.\d{3}Z$/, '') + m[4] + m[5] + ':' + m[6];
  return { name: m[1], email: m[2], date: iso };
}

const commitSha = gitText(['rev-parse', 'HEAD']);
const text = object(commitSha).body.toString('utf8');
const sep = text.indexOf('\n\n');
const headLines = text.slice(0, sep).split('\n');
const message = text.slice(sep + 2);
const treeSha = headLines.find(function (l) { return l.startsWith('tree ') }).slice(5).trim();
const parents = headLines.filter(function (l) { return l.startsWith('parent ') }).map(function (l) { return l.slice(7).trim(); });
const author = ident(headLines.find(function (l) { return l.startsWith('author ') }).slice(7));
const committer = ident(headLines.find(function (l) { return l.startsWith('committer ') }).slice(10));

const entries = walkTree(treeSha, '', []);
console.log(OWNER + '/' + REPO + '  ' + BRANCH + '  ' + commitSha.slice(0, 8) + '  共 ' + entries.length + ' 个文件');
const tree = new Array(entries.length);
let next = 0, done = 0;
async function upload(i) {
  const e = entries[i];
  const blob = await api('POST', '/repos/' + OWNER + '/' + REPO + '/git/blobs', {
    content: object(e.sha).body.toString('base64'),
    encoding: 'base64',
  });
  if (blob.sha !== e.sha) throw new Error(e.path + '：远端 blob 与本地不一致');
  tree[i] = { path: e.path, mode: e.mode, type: 'blob', sha: e.sha };
  done++;
  if (done % 50 === 0 || done === entries.length) console.log('  上传 ' + done + '/' + entries.length);
}
await Promise.all(new Array(4).fill(0).map(async function () {
  while (true) { const i = next++; if (i >= entries.length) return; await upload(i); }
}));

const madeTree = await api('POST', '/repos/' + OWNER + '/' + REPO + '/git/trees', { tree: tree });
if (madeTree.sha !== treeSha) throw new Error('tree SHA 不一致：远端 ' + madeTree.sha + ' / 本地 ' + treeSha);
const madeCommit = await api('POST', '/repos/' + OWNER + '/' + REPO + '/git/commits', {
  message: message, tree: madeTree.sha, parents: parents, author: author, committer: committer,
});
if (madeCommit.sha !== commitSha) throw new Error('commit SHA 不一致：远端 ' + madeCommit.sha + ' / 本地 ' + commitSha);

let ref = null;
try { ref = await api('GET', '/repos/' + OWNER + '/' + REPO + '/git/ref/heads/' + BRANCH); } catch (e) { ref = null; }
if (ref) await api('PATCH', '/repos/' + OWNER + '/' + REPO + '/git/refs/heads/' + BRANCH, { sha: madeCommit.sha });
else await api('POST', '/repos/' + OWNER + '/' + REPO + '/git/refs', { ref: 'refs/heads/' + BRANCH, sha: madeCommit.sha });

spawnSync('git', ['update-ref', 'refs/remotes/origin/' + BRANCH, madeCommit.sha], { cwd: REPO_DIR });
console.log('完成：' + OWNER + '/' + REPO + ' ' + BRANCH + ' -> ' + madeCommit.sha);
console.log('（远端与本地逐位一致；上传的字节取自 git 对象库，不是工作区）');