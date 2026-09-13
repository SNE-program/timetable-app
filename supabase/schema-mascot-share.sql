-- ============================================================================
-- 课表助手 · 云端角色的「分享码」（v1.9.3 追加）
-- ----------------------------------------------------------------------------
-- 在 supabase/schema-mascots.sql 之后执行；同样幂等，重复跑不会报错。
--
-- ## 为什么改成分享码
--
-- 原来的「公开角色」是所有人都能勾的：一旦公开，它就出现在所有人的「公开角色」
-- 列表里 —— 那是一个**广场**，谁都能翻。实际用下来只有两种情况：
--
--   1. 我只想让**某个人**用我做的角色（发给同学）；
--   2. 我不想让自己的东西出现在一个陌生人也能翻的列表里。
--
-- 所以改成：**用分享码定向分享**。码是随机生成的短串，只有拿到码的人能解析出
-- 那一个角色并下载；没有码什么都看不到（数据库里也没有"列出全部分享"的入口）。
--
-- 公开选项保留给额度不设限的那个账号（也就是项目作者自己）—— 客户端按
-- profiles.unlimited_mascots 判断要不要显示那个开关，服务端不因此放宽任何权限。
--
-- ## 为什么不直接用 RLS 写「分享中的行任何人都能读」
--
-- 那样会多出一个**可枚举**的面：任何人 select * from mascots where share_code is not null
-- 就能把所有人分享过的角色列出来（连名字带路径），分享码也就没意义了。
-- 所以这里只开两个「必须知道输入才能调用」的函数，一行策略都不放宽。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 分享码列
-- ---------------------------------------------------------------------------
alter table public.mascots add column if not exists share_code text;

comment on column public.mascots.share_code is
  '分享码：随机短串，拿到码的人能解析并下载这一个角色；为空表示未分享';

-- 格式：6–12 位大写字母与数字（客户端生成时避开了容易看错的 0/O/1/I/L）
alter table public.mascots drop constraint if exists mascots_share_code_format;
alter table public.mascots add constraint mascots_share_code_format
  check (share_code is null or share_code ~ '^[A-Z0-9]{6,12}$');

-- 唯一：两个角色不能撞码（部分索引，未分享的不参与）
create unique index if not exists mascots_share_code_key
  on public.mascots (share_code) where share_code is not null;
-- ---------------------------------------------------------------------------
-- 2. 凭码解析一条记录
--    只接受「精确匹配」：不知道码就查不出任何东西，也没法枚举
-- ---------------------------------------------------------------------------
create or replace function public.resolve_mascot_share(code text)
returns table (id uuid, name text, path text, size_bytes integer, is_public boolean)
language sql
security definer
set search_path = public
as $$
  select m.id, m.name, m.path, m.size_bytes, m.is_public
  from public.mascots m
  where m.share_code is not null
    and m.share_code = upper(btrim(coalesce(code, '')))
  limit 1;
$$;

revoke all on function public.resolve_mascot_share(text) from public;
grant execute on function public.resolve_mascot_share(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Storage：这个对象「正被分享」时，拿到码的人才能下载
--
--    策略表达式里不能直接 join public.mascots（RLS 会以调用者的身份再算一遍，
--    而调用者对那一行没有读权限 → 永远 false）。所以走一个 SECURITY DEFINER 函数：
--    它只回答一个是非题，不泄露任何内容。
-- ---------------------------------------------------------------------------
create or replace function public.mascot_is_shared(obj_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.mascots m
    where m.path = obj_name and m.share_code is not null
  );
$$;

revoke all on function public.mascot_is_shared(text) from public;
grant execute on function public.mascot_is_shared(text) to anon, authenticated;

drop policy if exists "mascots 对象: 被分享的任何人可读" on storage.objects;
create policy "mascots 对象: 被分享的任何人可读"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'mascots' and public.mascot_is_shared(name));

-- ---------------------------------------------------------------------------
-- 自检：分享码列在不在、两个函数在不在、策略在不在
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'mascots' and column_name = 'share_code') as "分享码列",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('resolve_mascot_share', 'mascot_is_shared')) as "函数数",
  (select count(*) from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'mascots 对象: 被分享的任何人可读') as "存储策略";
