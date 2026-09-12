import React from 'react';

/**
 * 内联 SVG 图标。
 *
 * ## 为什么不用 emoji
 *
 * emoji 的观感完全交给系统字体：同一行里 iOS、Android、Windows 会画出三种
 * 不同粗细、不同配色、甚至不同造型的字形，而且**无法跟随主题色** ——
 * 换深色主题时它还是那一套彩色贴纸。
 *
 * 对「工业风 + 可 DIY」的产品来说这是硬伤：用户调了半天主色和描边，
 * 结果一排彩色 emoji 杵在标签栏里。
 *
 * 换成 SVG 之后：单色、跟随 currentColor、粗细统一、尺寸可控，
 * 而且不需要额外字体文件（体积为 0）。
 *
 * 风格统一取自 Feather 那一路：24×24 画布、1.6 描边、圆角端点。
 */

export type IconName =
  | 'calendar' | 'sun' | 'tasks' | 'palette' | 'settings' | 'search'
  | 'lock' | 'ban' | 'archive' | 'bell' | 'clipboard' | 'leaf' | 'check' | 'target';

/** 只存路径数据，画布与描边属性统一由 Icon 施加，保证粗细一致 */
const PATHS: Record<IconName, string[]> = {
  calendar: [
    'M8 2v4M16 2v4',
    'M3 10h18',
    'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  ],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  ],
  tasks: [
    'M9 11l3 3L21 5',
    'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  ],
  palette: [
    'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3',
    'M1 14h6M9 8h6M17 16h6',
  ],
  settings: [
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  ],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4.2-4.2'],
  lock: [
    'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
    'M8 11V7a4 4 0 0 1 8 0v4',
  ],
  ban: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M5.6 5.6l12.8 12.8'],
  /* 归位：靶心。长按菜单的「回到默认位置」用它 */
  target: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 1.5v3', 'M12 19.5v3', 'M1.5 12h3', 'M19.5 12h3',
  ],
  archive: [
    'M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z',
    'M2 4h20v4H2z',
    'M10 12h4',
  ],
  bell: [
    'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8z',
    'M13.7 21a2 2 0 0 1-3.4 0',
  ],
  clipboard: [
    'M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z',
    'M16 5h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1',
  ],
  leaf: [
    'M11 20A7 7 0 0 1 4 13c0-6 8-10 16-10 0 9-5 15-9 17z',
    'M4 21c1-5 4-8 8-10',
  ],
  check: ['M20 6L9 17l-5-5'],
};

export function Icon(props: {
  name: IconName;
  size?: number;
  className?: string;
  /** 线宽，默认 1.6 —— 比常见的 2 细一点，更接近工业风的克制感 */
  width?: number;
}) {
  const size = props.size || 20;
  const d = PATHS[props.name];
  return (
    <svg
      className={props.className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={props.width || 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {d.map(function (p, i) { return <path key={i} d={p} />; })}
    </svg>
  );
}
