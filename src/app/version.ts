declare const __BUILD_TIME__: string;
declare const __APP_VERSION__: string;

/** 构建时间与版本号，由 vite.config.ts 在打包时注入 */
export const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
