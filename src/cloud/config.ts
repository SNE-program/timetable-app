declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

/**
 * 云备份的接入点（可选项）。
 *
 * ## 两条硬规矩
 *
 * 1. **这里只放 URL 与 anon key**。anon key 生来就是公开的（每个 Supabase 前端应用
 *    都把它打进包里），数据安全靠的是数据库的行级安全策略（RLS），不是这把钥匙。
 *    service_role key **绝不允许**出现在这个仓库或前端产物里 —— 它能绕过 RLS。
 * 2. **没配置就当这个功能不存在**：值为空时，设置页整块面板不渲染，
 *    应用里也不会有任何一处发起网络请求。本地开发、以及不想用云备份的用户，
 *    拿到的仍是那个"完全离线"的应用。
 *
 * 值由构建注入（见 vite.config.ts）：GitHub Actions 里读仓库变量
 * SUPABASE_URL / SUPABASE_ANON_KEY，本地读环境变量 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。
 */
function pick(v: string | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

export const SUPABASE_URL = pick(typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '').replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = pick(typeof __SUPABASE_ANON_KEY__ !== 'undefined' ? __SUPABASE_ANON_KEY__ : '');

/**
 * 测试用的临时配置。
 *
 * 存在的理由只有一个：请求层（client.ts）必须能测 —— 而它的入参是构建期注入的常量，
 * 单测里拿不到值。给一个显式的注入口，比让测试去改全局变量干净。
 * 名字带 __ForTest，源码里除了测试没有任何地方调用它。
 */
let override: { url: string; key: string } | null = null;

export function __setCloudConfigForTest(url: string, key: string): void {
  override = { url: url.replace(/\/+$/, ''), key: key };
}

/** 实际使用的接入点（测试注入优先） */
export function supabaseUrl(): string { return override ? override.url : SUPABASE_URL; }
export function supabaseKey(): string { return override ? override.key : SUPABASE_ANON_KEY; }

/** 这个构建里到底有没有接上云备份 */
export function cloudConfigured(): boolean {
  return supabaseUrl() !== '' && supabaseKey() !== '';
}

/**
 * 报告给用户看的接入点域名（不显示 key）。
 * 界面上要如实告诉用户"东西会发到哪台服务器"，只显示域名就够，且不泄露 key。
 */
export function cloudHost(): string {
  const url = supabaseUrl();
  if (!url) return '';
  try { return new URL(url).host; } catch (e) { return url; }
}
