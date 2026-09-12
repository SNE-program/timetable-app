import React from 'react';
import { isNativePlatform } from '../platform/nativeBridge';

/**
 * 电脑（大屏）布局开关。
 *
 * 为什么用 JS 判断宽度而不是纯 CSS 媒体查询：
 * 同一份代码在 Android 壳里也会跑，而平板横屏同样会超过 1024px ——
 * 那种情况下要保留手机那套底部标签栏，不能变成电脑的左侧边栏。
 * 所以这里加上"必须不是原生壳"这个条件，再用 matchMedia 订阅宽度变化，
 * 缩窗口时能实时切换，而不是只有刷新才生效。
 */
export const WIDE_QUERY = '(min-width: 1024px)';

function matches(): boolean {
  try { return window.matchMedia(WIDE_QUERY).matches; } catch (e) { return false; }
}

export function useWideLayout(): boolean {
  const eligible = !isNativePlatform();
  const [wide, setWide] = React.useState<boolean>(function () { return eligible && matches(); });

  React.useEffect(function () {
    if (!eligible) { setWide(false); return; }
    let mq: MediaQueryList;
    try { mq = window.matchMedia(WIDE_QUERY); } catch (e) { return; }
    const onChange = function (): void { setWide(mq.matches); };
    onChange();
    mq.addEventListener('change', onChange);
    return function () { mq.removeEventListener('change', onChange); };
  }, [eligible]);

  return wide;
}
