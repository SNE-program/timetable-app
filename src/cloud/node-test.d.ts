/**
 * 单测里用到的一点点 Node 能力。
 *
 * 为什么只声明这么几行，而不是装 @types/node：
 * 运行时代码（src 下除了 *.test.ts）**一行都不碰 Node API** —— 这是它能在
 * 浏览器与安卓 WebView 里跑的前提。装完整的一套 Node 类型进来，
 * 等于给"顺手 import 一个 node:xxx"开了门。
 *
 * 需要文件系统的只有两类测试：读 supabase/schema.sql 做配置防线检查、
 * 以及读源码确认没有把密钥写死。
 */
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const process: { cwd(): string; env: Record<string, string | undefined> };
