-- ============================================================================
-- 课表助手 · 云端角色（v1.7.0 追加）
-- ----------------------------------------------------------------------------
-- 在 supabase/schema.sql 之后执行；同样是幂等的，重复跑不会报错。
--
-- 三件事：
--   1. profiles  —— 每个账号一行的附加信息，目前只有一个「角色额度不设限」的标记，
--                   **客户端不能改它**（revoke 掉写权限，只能由服务端 / 管理员改）；
--   2. mascots   —— 云端角色：每人最多 2 个（额度不设限的账号除外），
--                   可以勾选「公开」，公开的任何人（含未登录）都能看到并使用；
--   3. Storage   —— 角色素材（可能几 MB）放对象存储，不放数据库行里：
--                   PostgREST 单次请求约 1 MB，把角色包塞进 jsonb 必然失败。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  unlimited_mascots boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.profiles is '账号附加信息：目前只有角色额度标记';
comment on column public.profiles.unlimited_mascots is '为真时不限制云端角色数量；只能由管理员在服务端修改';

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
-- 只给读，**不给写**：额度是服务端说了算的东西
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;

drop policy if exists "profiles: 读自己的" on public.profiles;
create policy "profiles: 读自己的"
  on public.profiles for select to authenticated
  using (auth.uid() = user_id);

-- 新用户自动建一行，省得每次查询都 coalesce
create or replace function public.profiles_autocreate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_autocreate on auth.users;
create trigger profiles_autocreate
  after insert on auth.users
  for each row execute function public.profiles_autocreate();

-- 把已有用户补上
insert into public.profiles (user_id)
select id from auth.users on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. mascots
-- ---------------------------------------------------------------------------
create table if not exists public.mascots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  is_public boolean not null default false,
  path text not null,
  size_bytes integer not null default 0 check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mascots is '云端角色：元信息在表里，角色包本身在 storage 的 mascots 桶';

create index if not exists mascots_owner on public.mascots (user_id, created_at desc);
create index if not exists mascots_public on public.mascots (created_at desc) where is_public;

alter table public.mascots enable row level security;

drop policy if exists "mascots: 读自己的或公开的" on public.mascots;
create policy "mascots: 读自己的或公开的"
  on public.mascots for select to anon, authenticated
  using (is_public or auth.uid() = user_id);

drop policy if exists "mascots: 写自己的" on public.mascots;
create policy "mascots: 写自己的"
  on public.mascots for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "mascots: 改自己的" on public.mascots;
create policy "mascots: 改自己的"
  on public.mascots for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "mascots: 删自己的" on public.mascots;
create policy "mascots: 删自己的"
  on public.mascots for delete to authenticated
  using (auth.uid() = user_id);

drop trigger if exists mascots_touch on public.mascots;
create trigger mascots_touch
  before update on public.mascots
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. 配额：每人 2 个（额度不设限的账号除外）
--    写在数据库里而不是只写在客户端 —— 客户端限制只能算提示，服务端才算数
-- ---------------------------------------------------------------------------
create or replace function public.mascot_quota_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cnt int;
  unl boolean;
begin
  select coalesce(unlimited_mascots, false) into unl from public.profiles where user_id = new.user_id;
  if coalesce(unl, false) then
    return new;
  end if;
  select count(*) into cnt from public.mascots where user_id = new.user_id;
  if cnt >= 2 then
    raise exception '云端角色最多 2 个：先在「我的角色」里删掉一个再上传'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists mascots_quota on public.mascots;
create trigger mascots_quota
  before insert on public.mascots
  for each row execute function public.mascot_quota_check();

-- ---------------------------------------------------------------------------
-- 4. Storage：私有桶 + 按目录归属的策略
--    路径第一段必须是自己的 user_id；公开的角色允许任何人读
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('mascots', 'mascots', false)
on conflict (id) do nothing;

drop policy if exists "mascots 对象: 读自己的或公开的" on storage.objects;
create policy "mascots 对象: 读自己的或公开的"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'mascots'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.mascots m where m.path = storage.objects.name and m.is_public)
    )
  );

drop policy if exists "mascots 对象: 写自己目录" on storage.objects;
create policy "mascots 对象: 写自己目录"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'mascots' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "mascots 对象: 改自己目录" on storage.objects;
create policy "mascots 对象: 改自己目录"
  on storage.objects for update to authenticated
  using (bucket_id = 'mascots' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "mascots 对象: 删自己目录" on storage.objects;
create policy "mascots 对象: 删自己目录"
  on storage.objects for delete to authenticated
  using (bucket_id = 'mascots' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 自检
-- ---------------------------------------------------------------------------
select c.relname as "表", c.relrowsecurity as "已开启RLS",
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as "策略数"
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('timetables', 'mail_log', 'profiles', 'mascots')
order by c.relname;
