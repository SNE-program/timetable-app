#!/usr/bin/env node
/**
 * 云端数据管理台（只读为主，本机运行）。
 *
 * ## 它解决什么问题
 *
 * 应用把数据存在项目自己的 Supabase 上（账号、课表备份、云端角色、APK）。
 * 想知道"网上到底存了什么、谁在用、占了多少"，原来只有两个办法：
 *
 *   1. 打开 supabase.com 的控制台翻表格 —— 能用，但每次都要点五六层，
 *      而且它只给原始行，不给"孤儿文件 / 超额 / 该清理什么"这类判断；
 *   2. 自己写 SQL —— 每次都要重新想一遍要查什么。
 *
 * 这个脚本把常用的问题固化成一串命令，输出是**给人看的**（先结论，再明细）。
 *
 * ## 为什么是本机脚本，而不是网站上再挂一个 /admin 页面
 *
 * 因为那需要把 service_role（或放宽 RLS 让某个账号能读所有人的数据）放到浏览器里 ——
 * 服务端密钥一旦进了前端就等于公开，而管理员页面又天然是攻击面。
 * 本机脚本用**项目级 Personal Access Token** 走管理 API，密钥只存在你电脑的环境变量里，
 * 浏览器与产物里永远没有它。
 *
 * ## 用法
 *
 *   node scripts/admin.mjs overview            # 一屏概览（含待处理项）
 *   node scripts/admin.mjs users              # 账号（邮箱默认打码，--full 看全）
 *   node scripts/admin.mjs backups            # 云端课表备份清单
 *   node scripts/admin.mjs mascots            # 云端角色（含分享码、公开状态）
 *   node scripts/admin.mjs shares             # 正在分享的码
 *   node scripts/admin.mjs storage            # 存储占用 + 孤儿文件
 *   node scripts/admin.mjs activity           # 最近发生的事
 *   node scripts/admin.mjs sql "select ..."   # 任意只读 SQL（写操作要 --write）
 *   node scripts/admin.mjs web                # 本机只读仪表盘 http://127.0.0.1:8787
 *
 *   --json / --csv 换输出格式；--full 显示完整邮箱；--write 允许写 SQL（危险，默认拒绝）
 *
 * ## 密钥从哪来
 *
 *   优先 $SUPABASE_ACCESS_TOKEN（那是 sbp_ 开头的项目级令牌），
 *   其次读仓库根的 权限合集.txt（它已在 .gitignore 里，不会进仓库）。
 *   密钥只用于 Authorization 头，任何命令都不会把它打印出来。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = 'oglzpevmqpcmryznqaiu';
const API = 'https://api.supabase.com/v1/projects/' + PROJECT_REF + '/database/query';

const args = process.argv.slice(2);
const flags = new Set(args.filter(function (a) { return a.indexOf('--') === 0; }));
const rest = args.filter(function (a) { return a.indexOf('--') !== 0; });
const cmd = rest[0] || 'overview';

function token() {
  const env = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (env) return env;
  const f = join(ROOT, '权限合集.txt');
  if (!existsSync(f)) return '';
  const m = readFileSync(f, 'utf8').match(/sbp_[A-Za-z0-9]+/);
  return m ? m[0] : '';
}

const PAT = token();
if (!PAT) {
  console.error('缺少项目令牌。设一个环境变量再来：');
  console.error('  PowerShell:  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."');
  process.exit(1);
}

/**
 * 跑一段 SQL。
 *
 * **默认只允许读**：写语句必须显式加 --write —— 这个工具会被人随手敲，
 * 而一个手滑的 delete 在云端是没有回收站的。
 */
async function sql(query, opts) {
  const write = !!(opts && opts.write);
  if (!write && !/^\s*(select|with|show|explain)\b/i.test(query)) {
    throw new Error('这条语句看起来会写数据。确认要执行就加 --write（它会直接改线上）');
  }
  const r = await fetch(API, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + PAT, 'content-type': 'application/json' },
    body: JSON.stringify({ query: query }),
  });
  const text = await r.text();
  if (r.status !== 200 && r.status !== 201) throw new Error('SQL 失败（' + r.status + '）：' + text.slice(0, 300));
  try { return JSON.parse(text); } catch (e) { return text; }
}

/* ------------------------------ 输出 ------------------------------ */

function table(rows) {
  if (!Array.isArray(rows) || rows.length === 0) { console.log('（没有数据）'); return; }
  const cols = Object.keys(rows[0]);
  const width = cols.map(function (c) {
    return Math.max(strWidth(c), Math.max.apply(null, rows.map(function (r) { return strWidth(fmt(r[c])); })));
  });
  const line = function (cells) {
    return cells.map(function (v, i) { return pad(fmt(v), width[i]); }).join('  ');
  };
  console.log(line(cols));
  console.log(width.map(function (w) { return '─'.repeat(w); }).join('  '));
  for (const r of rows) console.log(line(cols.map(function (c) { return r[c]; })));
}

/** 中日韩字符占两格，用等宽字体看中文表格才不会错位 */
function strWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += /[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch) ? 2 : 1;
  return w;
}
function pad(s, n) { const t = String(s); return t + ' '.repeat(Math.max(0, n - strWidth(t))); }
function fmt(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function print(rows) {
  if (flags.has('--json')) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (flags.has('--csv')) {
    if (!Array.isArray(rows) || !rows.length) { console.log(''); return; }
    const cols = Object.keys(rows[0]);
    const cell = function (v) {
      const s = fmt(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    console.log(cols.join(','));
    for (const r of rows) console.log(cols.map(function (c) { return cell(r[c]); }).join(','));
    return;
  }
  table(rows);
}
function head(title) { console.log('\n### ' + title); }

/** 邮箱默认打码：终端里滚过的内容经常会被截图发出去 */
function maskEmail(e) {
  if (flags.has('--full') || !e) return e || '—';
  const at = String(e).indexOf('@');
  if (at < 0) return e;
  const name = String(e).slice(0, at);
  return name.slice(0, 2) + '*'.repeat(Math.max(1, name.length - 2)) + String(e).slice(at);
}
function bytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}
function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const stamp = d.toISOString().slice(0, 16).replace('T', ' ');
  return stamp + (days > 0 ? '（' + days + ' 天前）' : '');
}
/* ------------------------------ 各条命令的数据 ------------------------------ */

async function qOverview() {
  const r = await sql(`
    select
      (select count(*) from auth.users) as 注册账号,
      (select count(*) from public.profiles where unlimited_mascots) as 不限额账号,
      (select count(*) from public.timetables) as 云端备份,
      (select pg_size_pretty(coalesce(sum(pg_column_size(payload)), 0)) from public.timetables) as 备份体积,
      (select count(*) from public.mascots) as 云端角色,
      (select count(*) from public.mascots where is_public) as 公开角色,
      (select count(*) from public.mascots where share_code is not null) as 分享中,
      (select coalesce(sum(size_bytes), 0) from public.mascots) as 角色声明体积,
      (select count(*) from storage.objects where bucket_id = 'mascots') as 角色文件数,
      (select pg_size_pretty(coalesce(sum((metadata->>'size')::bigint), 0)) from storage.objects where bucket_id = 'mascots') as 角色文件体积,
      (select count(*) from storage.objects where bucket_id = 'app') as 安装包文件数,
      (select pg_size_pretty(coalesce(sum((metadata->>'size')::bigint), 0)) from storage.objects where bucket_id = 'app') as 安装包体积
  `);
  print(r.map(function (x) {
    return Object.assign({}, x, { 角色声明体积: bytes(x.角色声明体积) });
  }));
}

/** 待处理项：这是这个工具比"翻表格"多出来的那部分价值 */
async function qIssues() {
  const orphans = await sql(`
    select o.name as 孤儿文件, pg_size_pretty((o.metadata->>'size')::bigint) as 大小, o.updated_at as 上传时间
    from storage.objects o
    where o.bucket_id = 'mascots'
      and not exists (select 1 from public.mascots m where m.path = o.name)
    order by o.updated_at desc
  `);
  const missing = await sql(`
    select m.name as 记录, m.path as 文件, m.size_bytes as 声明体积
    from public.mascots m
    where not exists (select 1 from storage.objects o where o.name = m.path and o.bucket_id = 'mascots')
  `);
  head('待处理：存储里没有对应记录的文件（可安全清理）');
  print(orphans);
  head('待处理：有记录但文件已不在（点开会下载失败）');
  print(missing);
  return { orphans: Array.isArray(orphans) ? orphans.length : 0, missing: Array.isArray(missing) ? missing.length : 0 };
}

async function qUsers() {
  const rows = await sql(`
    select
      left(u.id::text, 8) as 账号ID,
      u.email as 邮箱,
      u.created_at as 注册时间,
      u.last_sign_in_at as 最后登录,
      coalesce(p.unlimited_mascots, false) as 不限额,
      (select count(*) from public.timetables t where t.user_id = u.id) as 备份数,
      (select count(*) from public.mascots m where m.user_id = u.id) as 角色数
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    order by u.created_at desc
  `);
  print(rows.map(function (r) {
    return Object.assign({}, r, {
      邮箱: maskEmail(r.邮箱),
      注册时间: when(r.注册时间),
      最后登录: when(r.最后登录),
    });
  }));
  if (!flags.has('--full')) console.log('（邮箱已打码，要完整地址加 --full）');
}

async function qBackups() {
  const rows = await sql(`
    select
      u.email as 账号,
      pg_size_pretty(pg_column_size(t.payload)) as 大小,
      t.app_version as 应用版本,
      t.device as 设备,
      t.updated_at as 更新时间,
      t.payload->'data'->>'courses' is not null as 含课程
    from public.timetables t left join auth.users u on u.id = t.user_id
    order by t.updated_at desc
  `);
  print(rows.map(function (r) {
    return Object.assign({}, r, { 账号: maskEmail(r.账号), 更新时间: when(r.更新时间), 含课程: undefined });
  }));
}

async function qMascots() {
  const rows = await sql(`
    select
      m.name as 名称,
      u.email as 归属,
      m.is_public as 公开,
      m.share_code as 分享码,
      pg_size_pretty(m.size_bytes::bigint) as 声明体积,
      (select pg_size_pretty((o.metadata->>'size')::bigint) from storage.objects o where o.name = m.path) as 实际文件,
      m.created_at as 创建时间,
      m.updated_at as 更新时间
    from public.mascots m left join auth.users u on u.id = m.user_id
    order by m.created_at desc
  `);
  print(rows.map(function (r) {
    return Object.assign({}, r, { 归属: maskEmail(r.归属), 创建时间: when(r.创建时间), 更新时间: when(r.更新时间) });
  }));
}

async function qShares() {
  const rows = await sql(`
    select m.share_code as 分享码, m.name as 角色, u.email as 归属, m.is_public as 也公开, m.updated_at as 生成时间
    from public.mascots m left join auth.users u on u.id = m.user_id
    where m.share_code is not null order by m.updated_at desc
  `);
  print(rows.map(function (r) { return Object.assign({}, r, { 归属: maskEmail(r.归属), 生成时间: when(r.生成时间) }); }));
  console.log('说明：码只有拿到的人能用（未登录无法列出，服务端已收回该列的读权限）。');
}

async function qStorage() {
  const buckets = await sql(`
    select o.bucket_id as 桶, b.public as 公开, count(*) as 对象数,
           pg_size_pretty(sum((o.metadata->>'size')::bigint)) as 占用,
           pg_size_pretty(max((o.metadata->>'size')::bigint)) as 最大单个
    from storage.objects o join storage.buckets b on b.id = o.bucket_id
    group by o.bucket_id, b.public order by o.bucket_id
  `);
  print(buckets);
  const old = await sql(`
    select name as 文件, pg_size_pretty((metadata->>'size')::bigint) as 大小, updated_at::date as 上传日
    from storage.objects where bucket_id = 'app' order by updated_at desc
  `);
  head('安装包（app 桶，公开可下载：应用内更新与下载页都指向它）');
  print(old);
  console.log('提醒：免费额度是 1 GB 存储 + 每月 5 GB 流量；旧版本安装包可以留最近几个、其余删掉。');
}

async function qActivity() {
  const backups = await sql(`
    select '备份更新' as 动作, u.email as 账号, t.app_version as 详情, t.updated_at as 时间
    from public.timetables t left join auth.users u on u.id = t.user_id order by t.updated_at desc limit 8
  `);
  const mascots = await sql(`
    select '角色变动' as 动作, u.email as 账号, m.name as 详情, m.updated_at as 时间
    from public.mascots m left join auth.users u on u.id = m.user_id order by m.updated_at desc limit 8
  `);
  const mail = await sql(`
    select '发信' as 动作, u.email as 账号, l.subject as 详情, l.sent_at as 时间
    from public.mail_log l left join auth.users u on u.id = l.user_id order by l.sent_at desc limit 8
  `);
  const all = [].concat(backups || [], mascots || [], mail || [])
    .map(function (r) { return Object.assign({}, r, { 账号: maskEmail(r.账号), 时间: when(r.时间) }); })
    .sort(function (a, b) { return String(b.时间).localeCompare(String(a.时间)); });
  print(all);
}
/* ------------------------------ 本机只读仪表盘 ------------------------------ */

/**
 * `--web`：在本机起一个只读页面。
 *
 * 为什么要有它：终端里翻表格适合"查一个数"，但"把云端整个看一遍"更适合网页 ——
 * 能搜索、能排序、能放大看。它绑在 127.0.0.1（只本机能访问），数据由这个进程去取，
 * **页面里没有任何密钥**；把网址发给别人也打不开。
 */
async function serve() {
  const port = Number((rest[1] || '8787')) || 8787;
  const server = createServer(async function (req, res) {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/data') {
      try {
        const data = await collect();
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: (e && e.message) || String(e) }));
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  server.listen(port, '127.0.0.1', function () {
    console.log('云端数据管理台（只读）：http://127.0.0.1:' + port);
    console.log('这个地址只有本机能打开；页面里没有密钥，数据由本进程代取。Ctrl+C 结束。');
  });
}

async function collect() {
  const [overview, users, backups, mascots, buckets, orphans, missing, activity] = await Promise.all([
    sql('select (select count(*) from auth.users) as accounts, (select count(*) from public.timetables) as backups, (select count(*) from public.mascots) as mascots'),
    sql('select u.id::text as id, u.email, u.created_at, u.last_sign_in_at, coalesce(p.unlimited_mascots,false) as unlimited, (select count(*) from public.timetables t where t.user_id=u.id) as backups, (select count(*) from public.mascots m where m.user_id=u.id) as mascots from auth.users u left join public.profiles p on p.user_id=u.id order by u.created_at desc'),
    sql('select u.email, pg_column_size(t.payload) as bytes, t.app_version, t.device, t.updated_at from public.timetables t left join auth.users u on u.id=t.user_id order by t.updated_at desc'),
    sql('select m.name, u.email, m.is_public, m.share_code, m.size_bytes, m.created_at, m.updated_at from public.mascots m left join auth.users u on u.id=m.user_id order by m.created_at desc'),
    sql("select bucket_id, public, count(*) as n, sum((metadata->>'size')::bigint) as bytes from storage.objects o join storage.buckets b on b.id=o.bucket_id group by bucket_id, public"),
    sql("select o.name, (o.metadata->>'size')::bigint as bytes, o.updated_at from storage.objects o where o.bucket_id='mascots' and not exists (select 1 from public.mascots m where m.path=o.name)"),
    sql("select m.name, m.path from public.mascots m where not exists (select 1 from storage.objects o where o.name=m.path and o.bucket_id='mascots')"),
    sql("select '备份' as kind, u.email, t.app_version as detail, t.updated_at as at from public.timetables t left join auth.users u on u.id=t.user_id union all select '角色' as kind, u.email, m.name as detail, m.updated_at as at from public.mascots m left join auth.users u on u.id=m.user_id union all select '发信' as kind, u.email, l.subject as detail, l.sent_at as at from public.mail_log l left join auth.users u on u.id=l.user_id"),
  ]);
  return { overview: overview, users: users, backups: backups, mascots: mascots, buckets: buckets, orphans: orphans, missing: missing, activity: activity, fetchedAt: new Date().toISOString() };
}

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>云端数据管理台</title><style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;background:#f6f7f9;color:#1d2129}
header{padding:16px 20px;background:#1d2129;color:#fff;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
header h1{font-size:16px;margin:0}header span{opacity:.7;font-size:12px}
main{padding:16px 20px 60px;max-width:1100px;margin:0 auto}
section{background:#fff;border:1px solid #e2e3e6;border-radius:10px;padding:14px 16px;margin:0 0 16px}
h2{font-size:15px;margin:0 0 10px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:6px 8px;border-bottom:1px solid #eef0f2;text-align:left;vertical-align:top}
th{color:#6b7280;font-weight:600;white-space:nowrap}
code{background:#f2f3f5;padding:1px 5px;border-radius:4px}
.warn{color:#b4690e}.bad{color:#c0392b}.ok{color:#0a7d33}
.chips{display:flex;gap:10px;flex-wrap:wrap}
.chip{background:#f2f3f5;border-radius:8px;padding:8px 12px;min-width:120px}
.chip b{display:block;font-size:18px}
input[type=search]{width:100%;padding:8px 10px;border:1px solid #e2e3e6;border-radius:8px;margin-bottom:8px}
.muted{color:#6b7280;font-size:12px}
</style></head><body>
<header><h1>云端数据管理台</h1><span id="meta"></span><span>只读 · 只有本机能打开</span></header>
<main id="main">正在读取…</main>
<script>
function esc(s){return String(s===null||s===undefined?'—':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
function bytes(n){n=Number(n)||0;if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(1)+' MB';}
function ago(iso){if(!iso)return '—';const d=new Date(iso);const days=Math.floor((Date.now()-d)/86400000);return d.toISOString().slice(0,16).replace('T',' ')+(days>0?'（'+days+' 天前）':'');}
function tbl(rows,cols,map){
  if(!rows||!rows.length)return '<p class="muted">（没有数据）</p>';
  map=map||{};
  return '<table><thead><tr>'+cols.map(function(c){return '<th>'+esc(c.t)+'</th>';}).join('')+'</tr></thead><tbody>'+
    rows.map(function(r){return '<tr>'+cols.map(function(c){return '<td>'+esc(map[c.k]?map[c.k](r[c.k]):r[c.k])+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>';
}
fetch('/api/data').then(function(r){return r.json();}).then(function(d){
  if(d.error){document.getElementById('main').innerHTML='<section class="bad">读取失败：'+esc(d.error)+'</section>';return;}
  const o=d.overview[0]||{};
  document.getElementById('meta').textContent='取数时间 '+ago(d.fetchedAt)+' · 项目 oglzpevmqpcmryznqaiu';
  let html='';
  html+='<section><h2>概览</h2><div class="chips">'+
    '<div class="chip">注册账号<b>'+esc(o.accounts)+'</b></div>'+
    '<div class="chip">云端备份<b>'+esc(o.backups)+'</b></div>'+
    '<div class="chip">云端角色<b>'+esc(o.mascots)+'</b></div>'+
    (d.buckets||[]).map(function(b){return '<div class="chip">'+esc(b.bucket_id)+(b.public?'（公开）':'（私有）')+'<b>'+esc(b.n)+' 个</b><span class="muted">'+bytes(b.bytes)+'</span></div>';}).join('')+
  '</div></section>';
  if((d.orphans||[]).length||(d.missing||[]).length){
    html+='<section><h2 class="warn">待处理</h2>';
    if((d.orphans||[]).length)html+='<p class="warn">存储里有 '+(d.orphans.length)+' 个文件没有对应记录（可清理，共 '+bytes(d.orphans.reduce(function(s,x){return s+Number(x.bytes||0);},0))+'）：</p>'+tbl(d.orphans,[{k:'name',t:'文件'},{k:'bytes',t:'大小'},{k:'updated_at',t:'上传时间'}],{bytes:bytes,updated_at:ago});
    if((d.missing||[]).length)html+='<p class="bad">有 '+(d.missing.length)+' 条记录的文件已经不在存储里（下载会失败）。</p>'+tbl(d.missing,[{k:'name',t:'角色'},{k:'path',t:'文件'}]);
    html+='</section>';
  }
  html+='<section><h2>账号（'+((d.users||[]).length)+'）</h2><input id="uq" type="search" placeholder="按邮箱过滤…"><div id="utable">'+
    tbl(d.users,[{k:'email',t:'邮箱'},{k:'created_at',t:'注册'},{k:'last_sign_in_at',t:'最后登录'},{k:'unlimited',t:'不限额'},{k:'backups',t:'备份'},{k:'mascots',t:'角色'}],{created_at:ago,last_sign_in_at:ago})+'</div></section>';
  html+='<section><h2>云端备份（'+((d.backups||[]).length)+'）</h2>'+tbl(d.backups,[{k:'email',t:'账号'},{k:'bytes',t:'大小'},{k:'app_version',t:'应用版本'},{k:'device',t:'设备'},{k:'updated_at',t:'更新时间'}],{bytes:bytes,updated_at:ago})+'</section>';
  html+='<section><h2>云端角色（'+((d.mascots||[]).length)+'）</h2>'+tbl(d.mascots,[{k:'name',t:'名称'},{k:'email',t:'归属'},{k:'is_public',t:'公开'},{k:'share_code',t:'分享码'},{k:'size_bytes',t:'声明体积'},{k:'updated_at',t:'更新时间'}],{bytes:bytes,updated_at:ago})+'</section>';
  html+='<section><h2>最近发生的事</h2>'+tbl((d.activity||[]).slice().sort(function(a,b){return String(b.at).localeCompare(String(a.at));}).slice(0,15),[{k:'kind',t:'类型'},{k:'email',t:'账号'},{k:'detail',t:'内容'},{k:'at',t:'时间'}],{at:ago})+'</section>';
  document.getElementById('main').innerHTML=html;
  const uq=document.getElementById('uq');
  if(uq)uq.addEventListener('input',function(){
    const q=uq.value.toLowerCase();
    document.getElementById('utable').innerHTML=tbl((d.users||[]).filter(function(u){return String(u.email||'').toLowerCase().indexOf(q)>=0;}),[{k:'email',t:'邮箱'},{k:'created_at',t:'注册'},{k:'last_sign_in_at',t:'最后登录'},{k:'unlimited',t:'不限额'},{k:'backups',t:'备份'},{k:'mascots',t:'角色'}],{created_at:ago,last_sign_in_at:ago});
  });
}).catch(function(e){document.getElementById('main').innerHTML='<section class="bad">'+esc(e.message)+'</section>';});
</script></body></html>`;

/* ------------------------------ 入口 ------------------------------ */

const COMMANDS = {
  overview: qOverview,
  users: qUsers,
  backups: qBackups,
  mascots: qMascots,
  shares: qShares,
  storage: qStorage,
  activity: qActivity,
};

async function main() {
  if (cmd === 'web') { await serve(); return; }
  if (cmd === 'issues') { await qIssues(); return; }
  if (cmd === 'sql') {
    const query = rest.slice(1).join(' ');
    if (!query) { console.error('用法：node scripts/admin.mjs sql "select ..."'); process.exit(1); }
    print(await sql(query, { write: flags.has('--write') }));
    return;
  }
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error('不认识的命令：' + cmd);
    console.error('可用：' + Object.keys(COMMANDS).join(' / ') + ' / issues / sql / web');
    process.exit(1);
  }
  await fn();
  if (cmd === 'overview') await qIssues();
}

main().catch(function (e) {
  console.error('失败：' + ((e && e.message) || e));
  process.exit(1);
});