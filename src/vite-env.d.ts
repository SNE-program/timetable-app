/// <reference types="vite/client" />

/*
 * Vite 的客户端类型声明。
 * 它让 tsc 认识 `import './styles/base.css'` 这类副作用导入 ——
 * 否则类型检查会在 main.tsx 上报"找不到模块"，白白淹掉真正的错误。
 */
