-- 安装包分发桶（v1.8.2 追加）
-- 为什么不用 GitHub Releases：国内网络到 github.com / *.githubusercontent.com 经常连不上，
-- 应用内更新点下去就是 failed to connect。Supabase 的域名走 Cloudflare，课堂网络里是通的
-- （云备份能登录就证明这一点），所以安装包改放这里，GitHub 那边保留一份作为备选。
insert into storage.buckets (id, name, public)
values ('app', 'app', true)
on conflict (id) do update set public = true;

-- 公开读：任何人（含未登录、含应用内直接下载）都能取
drop policy if exists "app 桶: 公开读" on storage.objects;
create policy "app 桶: 公开读"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'app');

-- 刻意**不建**任何写策略：上传只能走 service_role（发布流程用它），
-- 否则任何人都能往这里塞东西。
revoke insert, update, delete on storage.objects from anon, authenticated;

select id, public, file_size_limit from storage.buckets where id in ('app', 'mascots');
