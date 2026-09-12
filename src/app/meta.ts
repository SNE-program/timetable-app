import { isNativePlatform } from '../platform/nativeBridge';

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

/**
 * 邮件里那些链接应该跳回的站点。
 *
 * 网页版就用当前地址（本地调试、自定义域名都对）；**安卓版必须用这个固定地址** ——
 * 应用内的页面地址是 https://localhost/，邮件客户端打不开它，
 * Supabase 的回调白名单里也不该出现它。
 */
export const PUBLIC_SITE_URL = 'https://timble.bond/';

/**
 * 检查更新去看的那个清单。
 *
 * **安卓里必须用远端地址**：应用内那份 latest.json 是"装机那一刻"的副本，
 * 拿它比版本号永远比不出新版本（这份文件本身不会更新）。网页版相反 ——
 * 它每次打开都是从服务器现取的，所以相对路径就是最新的一份。
 *
 * 第一个能取到的就用：github.io 的地址今天就能用；换成自定义域名之后，
 * 它会被 302 到 timble.bond，fetch 会自动跟随，所以两个都留着更稳。
 */
export const UPDATE_MANIFEST_URLS: string[] = [
  'https://sne-program.github.io/timetable-app/latest.json',
  PUBLIC_SITE_URL + 'latest.json',
];

export function updateManifestUrls(): string[] {
  try {
    if (isNativePlatform()) return UPDATE_MANIFEST_URLS;
    return ['./latest.json'];
  } catch (e) {
    return UPDATE_MANIFEST_URLS;
  }
}

export function emailRedirectUrl(): string {
  try {
    if (isNativePlatform()) return PUBLIC_SITE_URL;
    return window.location.origin + window.location.pathname;
  } catch (e) {
    return PUBLIC_SITE_URL;
  }
}

/** 稳定下载地址：永远指向最新一版（发布时同时上传这个名字的附件） */
export const ANDROID_LATEST_APK = REPO_URL ? REPO_URL + '/releases/latest/download/timetable-app.apk' : '';
