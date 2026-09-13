import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 云备份的**配置防线**。
 *
 * 这些东西没法用运行时单测覆盖（要连真数据库），但它们恰恰是"一旦写错就是事故"的部分：
 *   - 建表脚本忘了开 RLS → 所有人的备份对全世界可读；
 *   - service_role key 出现在前端源码里 → 同上，等于没有 RLS；
 *   - 发信函数读了请求体里的收件人 → 变成一台开放的垃圾邮件机。
 *
 * 所以改成**读文件断言**：便宜、每次跑测试都执行、错了当场红。
 */

const ROOT = process.cwd();
const SCHEMA = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8');
const MASCOTS = readFileSync(join(ROOT, 'supabase', 'schema-mascots.sql'), 'utf8');
const SHARE = readFileSync(join(ROOT, 'supabase', 'schema-mascot-share.sql'), 'utf8');
const SEND_MAIL = readFileSync(join(ROOT, 'supabase', 'functions', 'send-mail', 'index.ts'), 'utf8');
const DELETE_ACCOUNT = readFileSync(join(ROOT, 'supabase', 'functions', 'delete-account', 'index.ts'), 'utf8');

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

describe('建表脚本', function () {
  const tables = [...SCHEMA.matchAll(/create table if not exists public\.(\w+)/g)].map(function (m) { return m[1]; });

  it('至少建了 timetables 与 mail_log 两张表', function () {
    expect(tables).toContain('timetables');
    expect(tables).toContain('mail_log');
  });

  it('每张表都开了行级安全 —— 少一张就等于把数据公开', function () {
    for (const t of tables) {
      expect(SCHEMA).toContain('alter table public.' + t + ' enable row level security');
    }
  });

  it('timetables 有且只有四条自己的策略（读 / 写 / 改 / 删）', function () {
    const policies = [...SCHEMA.matchAll(/create policy "([^"]+)"[\s\S]*?on public\.(\w+)/g)]
      .filter(function (m) { return m[2] === 'timetables'; });
    expect(policies.length).toBe(4);
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(SCHEMA).toContain('on public.timetables for ' + op);
    }
    /* 每条都必须限定 auth.uid() = user_id，不允许出现"给所有人"的写法 */
    expect(SCHEMA).not.toMatch(/using\s*\(\s*true\s*\)/);
  });

  it('mail_log 不授权给客户端：收回权限且不建任何策略', function () {
    expect(SCHEMA).toContain('revoke all on public.mail_log from anon, authenticated');
    const policies = [...SCHEMA.matchAll(/create policy "([^"]+)"[\s\S]*?on public\.(\w+)/g)]
      .filter(function (m) { return m[2] === 'mail_log'; });
    expect(policies.length).toBe(0);
  });

  it('有体积上限这一道闸（免费额度单次请求约 1 MB）', function () {
    expect(SCHEMA).toContain('timetables_payload_max');
    expect(SCHEMA).toContain('1048576');
  });
});

describe('前端源码里不许出现的东西', function () {
  it('service_role / service key 绝不出现在 src 下', function () {
    const files = walk(join(ROOT, 'src'), []);
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      /* 允许注释里提到"绝不放 service_role" —— 所以只抓像密钥的用法 */
      if (/SERVICE_ROLE_KEY\s*[:=]\s*['"`]/.test(text)) bad.push(f);
      if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(text)) bad.push(f + '（疑似写死的 JWT）');
    }
    expect(bad).toEqual([]);
  });

  it('anon key 只能来自构建注入，不许写死在源码里', function () {
    const config = readFileSync(join(ROOT, 'src', 'cloud', 'config.ts'), 'utf8');
    expect(config).toContain('__SUPABASE_ANON_KEY__');
    expect(config).toMatch(/declare const __SUPABASE_ANON_KEY__/);
  });
});

describe('Edge Function 的安全性质', function () {
  it('发信函数只发给 token 里的邮箱，绝不读请求体里的收件人', function () {
    expect(SEND_MAIL).toContain('to: [email]');
    expect(SEND_MAIL).not.toMatch(/body\.to\b/);
    expect(SEND_MAIL).not.toMatch(/to:\s*\[?\s*body/);
  });

  it('发信函数有频率限制，且 Resend key 只从环境变量读', function () {
    expect(SEND_MAIL).toContain('MAX_PER_HOUR');
    expect(SEND_MAIL).toContain("Deno.env.get('RESEND_API_KEY')");
    expect(SEND_MAIL).not.toMatch(/re_[A-Za-z0-9]{10,}/);
  });

  it('注销函数只删调用者自己，且不手搓 JWT', function () {
    expect(DELETE_ACCOUNT).toContain("/auth/v1/user");
    expect(DELETE_ACCOUNT).not.toMatch(/userId\s*=\s*(body|req)/);
    expect(DELETE_ACCOUNT).not.toMatch(/re_[A-Za-z0-9]{10,}/);
  });

  it('两个函数都不在仓库里硬编码任何密钥', function () {
    for (const src of [SEND_MAIL, DELETE_ACCOUNT]) {
      expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./);
    }
  });
});

describe('云端角色的分享码', function () {
  it('两个函数都是 SECURITY DEFINER —— 否则 RLS 会让它们永远返回空', function () {
    /*
     * 这一条不是洁癖：Storage 的策略表达式里不能直接 join mascots（会以调用者的
     * 身份再算一遍 RLS），所以必须走 DEFINER 函数。写漏了的表现是
     * 「分享码能查到、但下载 403」—— 两边各查一半，很难想到是这里。
     */
    const fns = SHARE.split('create or replace function').slice(1);
    expect(fns.length).toBe(2);
    for (const fn of fns) expect(fn.slice(0, 400)).toContain('security definer');
  });

  it('函数执行权限给了 anon：拿到码的人不需要账号', function () {
    for (const fn of ['resolve_mascot_share(text)', 'mascot_is_shared(text)']) {
      expect(SHARE).toContain('grant execute on function public.' + fn + ' to anon, authenticated');
      expect(SHARE).toContain('revoke all on function public.' + fn + ' from public');
    }
  });

  it('★ 没有把「分享中的行」开放给任何人读 —— 那等于让码失去意义', function () {
    /* 一旦有人能 select 出 share_code is not null 的行，就能把所有人的角色列出来 */
    expect(SHARE).not.toMatch(/create policy[\s\S]{0,200}?for select[\s\S]{0,200}?share_code is not null/i);
    /* 分享码本身只能是「知道才能查」：函数里必须是精确相等 */
    expect(SHARE).toContain('m.share_code = upper(btrim(coalesce(code');
    expect(SHARE).not.toMatch(/share_code like/i);
  });

  it('分享码有格式约束与唯一索引', function () {
    expect(SHARE).toContain('mascots_share_code_format');
    expect(SHARE).toContain('create unique index if not exists mascots_share_code_key');
    expect(SHARE).toContain("[A-Z0-9]{6,12}");
  });

  it('Storage 那条策略只放行「被分享的对象」', function () {
    expect(SHARE).toContain('public.mascot_is_shared(name)');
    expect(SHARE).toContain("bucket_id = 'mascots'");
  });
});

describe('角色表与配额', function () {
  it('mascots 开了 RLS，且写操作都限定自己那一行', function () {
    expect(MASCOTS).toContain('alter table public.mascots enable row level security');
    expect(MASCOTS).toContain('with check (auth.uid() = user_id)');
  });

  it('配额在数据库触发器里，不在客户端', function () {
    expect(MASCOTS).toContain('mascot_quota_check');
    expect(MASCOTS).toContain('云端角色最多 2 个');
  });
});
