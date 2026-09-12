-- ============================================================================
-- 课表助手 · 云备份（可选功能）建表脚本
-- ----------------------------------------------------------------------------
-- 用法：Supabase 控制台 → SQL Editor → 整段粘贴 → Run。
-- 脚本是**幂等**的：重复执行不会报错，也不会清掉已有数据。
--
-- 设计原则只有一条：**每一位用户只可能碰到自己那一行**。
-- 客户端的 anon key 是公开的（每个 Supabase 前端应用都把它打进包里），
-- 所以数据安全完全靠下面的行级安全策略（RLS）—— 关掉 RLS 等于把所有人的备份公开。
-- ============================================================================

create table if not exists public.timetables (
  -- 一位用户一行：主键就是 auth.users 的 id，天然不会串号
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- 就是应用里「导出课表数据」那份 JSON，原样放进来
  payload jsonb not null,
  app_version text not null default '',
  -- 只用来在界面上区分「这份备份是哪台设备传的」，不参与任何逻辑
  device text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.timetables is '课表助手云备份：每位用户一行，payload 是导出的那份 JSON';
comment on column public.timetables.payload is '含 data / prefs / theme / assets / stats，见 src/cloud/backup.ts';

-- ---------------------------------------------------------------------------
-- 体积上限：免费额度单次请求约 1 MB。客户端已经先算过字节数并按需丢图片，
-- 这里是最后一道闸 —— 越过它就直接拒绝，而不是悄悄存半份。
-- ---------------------------------------------------------------------------
alter table public.timetables drop constraint if exists timetables_payload_max;
alter table public.timetables
  add constraint timetables_payload_max check (pg_column_size(payload) < 1048576);

-- ---------------------------------------------------------------------------
-- updated_at 自动维护（客户端时钟不可信，时间戳一律以服务器为准）
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists timetables_touch on public.timetables;
create trigger timetables_touch
  before update on public.timetables
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 行级安全：**必须开**
-- ---------------------------------------------------------------------------
alter table public.timetables enable row level security;
-- 顺带把表的直接授权收紧：即使将来有人误加了 policy，没有这张表的权限也读不到
revoke all on public.timetables from anon;
grant select, insert, update, delete on public.timetables to authenticated;

drop policy if exists "timetables: 读自己的" on public.timetables;
create policy "timetables: 读自己的"
  on public.timetables for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "timetables: 写自己的" on public.timetables;
create policy "timetables: 写自己的"
  on public.timetables for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "timetables: 改自己的" on public.timetables;
create policy "timetables: 改自己的"
  on public.timetables for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "timetables: 删自己的" on public.timetables;
create policy "timetables: 删自己的"
  on public.timetables for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 发信记账：Edge Function send-mail 用来做频率限制（每小时 5 封、每天 20 封）。
-- 客户端**不授权**这张表：只有服务端的 service_role 能写，用户读不到也写不了。
-- ---------------------------------------------------------------------------
create table if not exists public.mail_log (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text not null default '',
  sent_at timestamptz not null default now()
);
create index if not exists mail_log_user_time on public.mail_log (user_id, sent_at desc);

alter table public.mail_log enable row level security;
revoke all on public.mail_log from anon, authenticated;
-- 故意不建任何 policy：RLS 开着 + 没有策略 = 谁都读不到；
-- 函数用 service_role，它绕过 RLS，所以只有服务端能记账。

-- ---------------------------------------------------------------------------
-- 自检：跑完这段应该看到 2 行（timetables 与 mail_log 都开着 RLS）
-- ---------------------------------------------------------------------------
select c.relname as "表",
       c.relrowsecurity as "已开启RLS",
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as "策略数"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('timetables', 'mail_log')
order by c.relname;
