-- ============================================================================
-- 课表助手 · 分享码的读权限收紧（v1.9.7 追加，已应用到线上项目）
-- ----------------------------------------------------------------------------
-- 在 supabase/schema-mascot-share.sql 之后执行；幂等，可重复跑。
--
-- ## 修的是什么
--
-- 分享码的设计前提是「码就是凭据」：不知道码就什么都拿不到。但 1.9.3 那版把
-- share_code 放在 mascots 表的普通列上，而那张表对 anon 开放了公开行的读权限 ——
-- 于是一个**没登录的人**可以直接：
--
--     GET /rest/v1/mascots?select=id,name,share_code
--
-- 把「公开」的角色连同分享码一起列出来（实测确实拿得到）。码一旦能被枚举，
-- 「只有拿到码的人能用」这句承诺就不成立了。
--
-- ## 为什么不能只写 revoke select (share_code)
--
-- 第一版就是这么写的，**没生效**。原因：Postgres 里表级 SELECT 会覆盖所有列，
-- 而 information_schema.column_privileges 又会把表级授权**铺到每一列上显示** ——
-- 看上去像是"列级授权"，实际上撤不动。必须：
--
--   1. 撤掉 anon 的**表级** SELECT；
--   2. 再把 anon 真正需要的那些列**按列**授回去。
--
-- 这样 anon 依然能列公开角色（界面需要），但读不到 share_code。
--
-- ## 谁不受影响
--
--   * authenticated（登录后的应用）：表级 SELECT 原样保留，自己的码照常读；
--   * resolve_mascot_share / mascot_is_shared：SECURITY DEFINER，按定义者权限读，
--     所以"拿到码的人"这条路一点没变（实测：指定真实码仍能解析并下载 4.7MB 的对象）；
--   * 下载：Storage 策略仍然只认"这个对象正被分享"。
--
-- ## 兼容性（如实记下）
--
-- 1.9.6 及更早的客户端在**未登录**时会 select share_code，收紧之后那条请求会 401。
-- 影响面只有"未登录 + 打开云端角色面板"这一条路；1.9.7 起未登录时不再请求这一列。
-- ============================================================================

revoke select on public.mascots from anon;
grant select (id, user_id, name, is_public, path, size_bytes, created_at, updated_at)
  on public.mascots to anon;

-- ---------------------------------------------------------------------------
-- 自检（应看到：anon 表级授权里没有 SELECT；列级授权里没有 share_code）
-- ---------------------------------------------------------------------------
select
  (select coalesce(string_agg(privilege_type, ','), '(无)')
     from information_schema.table_privileges
     where table_schema = 'public' and table_name = 'mascots' and grantee = 'anon'
       and privilege_type = 'SELECT') as "anon 表级 SELECT",
  (select coalesce(string_agg(column_name, ','), '(无)')
     from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'mascots' and grantee = 'anon'
       and privilege_type = 'SELECT' and column_name = 'share_code') as "anon 能读 share_code？";
