declare const __REPO_URL__: string;

/**
 * 项目主页地址。
 *
 * 由构建注入：GitHub Actions 里直接取 GITHUB_REPOSITORY，本地构建默认是空串。
 * 留空时，界面上所有"去下载 Android 版"的入口会自动隐藏 —— 宁可不显示，
 * 也不要指向一个猜出来的地址。
 */
export const REPO_URL = typeof __REPO_URL__ !== 'undefined' ? __REPO_URL__ : '';

/** 所有版本的列表页；没有仓库地址时为空 */
export const ANDROID_RELEASE_URL = REPO_URL ? REPO_URL + '/releases/latest' : '';

/**
 * 站内的「获取 Android 版」页面。
 *
 * 用相对路径：构建产物既可能挂在 Pages 的项目页子路径下，也可能挂在别处，
 * 相对地址两处都对。这个页面就在 dist/download/ 里（源文件 public/download/index.html），
 * 所以任何构建里都存在，不会出现死链 —— 和 ANDROID_RELEASE_URL 那种"必须配置了仓库地址才有"的不一样。
 */
export const DOWNLOAD_PAGE = './download/';

/** 稳定下载地址：永远指向最新一版（发布时同时上传这个名字的附件） */
export const ANDROID_LATEST_APK = REPO_URL ? REPO_URL + '/releases/latest/download/timetable-app.apk' : '';
