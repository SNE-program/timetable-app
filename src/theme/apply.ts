import { applyTokens, resolveDark, resolveTokens, type Theme } from './tokens';
import { wallpaperSrc } from './wallpaper';

/**
 * 把主题真正落到 DOM。
 *
 * 壁纸刻意不走 CSS 变量，而是直接写到 .wallpaper 元素上：
 * 自定义图片是几百 KB 的 base64，塞进自定义属性再被 var() 引用，
 * 长度和转义都容易出问题（之前自定义壁纸不显示就是这个原因）。
 */
export function applyThemeToDom(theme: Theme, systemDark: boolean): void {
  const vars = resolveTokens(theme, systemDark);
  applyTokens(vars);

  const wp = theme.wallpaper;
  let image = 'none';
  if (wp.kind === 'preset' && wp.presetId) {
    const src = wallpaperSrc(wp.presetId);
    if (src) image = 'url("' + src + '")';
  } else if (wp.kind === 'custom' && wp.custom && wp.custom.indexOf('data:') === 0) {
    /*
     * 只认 data URI。图片本体存在 SQLite 里，挂载前是 `asset:<key>` 引用，
     * 还原完才是 data URI —— 这里不挡一下的话，浏览器会去请求一个叫 asset:xxx
     * 的地址，控制台一堆报错，壁纸也不会显示。挡住之后最多是壁纸晚一拍出现。
     */
    image = 'url("' + wp.custom + '")';
  }

  const el = document.querySelector('.wallpaper') as HTMLElement | null;
  if (el) {
    el.style.backgroundImage = image;
    el.style.display = image === 'none' ? 'none' : '';

    const fit = wp.fit || 'cover';
    if (fit === 'contain') {
      el.style.backgroundSize = 'contain';
      el.style.backgroundRepeat = 'no-repeat';
    } else if (fit === 'repeat') {
      el.style.backgroundSize = 'auto 42%';
      el.style.backgroundRepeat = 'repeat';
    } else {
      el.style.backgroundSize = 'cover';
      el.style.backgroundRepeat = 'no-repeat';
    }

    /* 只有开了模糊才放大一点点遮住模糊边缘；否则原样显示，避免无谓的放大 */
    el.style.transform = wp.blur > 0 ? 'scale(1.06)' : 'none';
  }

  const dark = resolveDark(theme.modePref, systemDark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? theme.darkBg : theme.lightBg);
}
