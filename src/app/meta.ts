declare const __REPO_URL__: string;

/**
 * 项目主页地址。
 *
 * 由构建注入：GitHub Actions 里直接取 GITHUB_REPOSITORY，本地构建默认是空串。
 * 留空时，界面上所有"去下载 Android 版"的入口会自动隐藏 —— 宁可不显示，
 * 也不要指向一个猜出来的地址。
 */
export const REPO_URL = typeof __REPO_URL__ !== 'undefined' ? __REPO_URL__ : '';

/** Android 安装包的下载页；没有仓库地址时为空 */
export const ANDROID_RELEASE_URL = REPO_URL ? REPO_URL + '/releases/latest' : '';
