/**
 * 登录之后该问用户什么（纯逻辑，好测）。
 *
 * ## 为什么登录成功要停下来问一句
 *
 * 登录之后必然面对一个岔路：云端那份备份和本机这份课表，谁说了算？
 * 猜错的代价是**丢数据** —— 无论往哪边覆盖，被覆盖的那一份就没了。
 * 所以这里不做"聪明的自动合并"（那需要冲突策略，而这一版刻意只做手动同步），
 * 而是把两种情况摆出来让用户点。
 *
 * 四种情形，只有前三种需要问：
 *
 * | 云端 | 本机 | 问什么 |
 * | --- | --- | --- |
 * | 有备份 | 有课表 | 用云端覆盖本机，还是把本机传上去 |
 * | 有备份 | 空 | 要不要把云端这份恢复过来 |
 * | 没备份 | 有课表 | 要不要把本机这份备份上去 |
 * | 没备份 | 空 | 没什么可同步的，不打扰 |
 */

export interface SyncSituation {
  /** 本机课程数（0 = 本机是空的） */
  localCourses: number;
  /** 云端有没有备份 */
  cloudHasBackup: boolean;
}

export type SyncPromptKind = 'both' | 'restore' | 'backup' | 'none';

export interface SyncPrompt {
  kind: SyncPromptKind;
  title: string;
  lead: string;
  /** 主按钮（点下去会发生什么，写在按钮上） */
  primary?: { text: string; action: 'restore' | 'backup' };
  /** 次按钮 */
  secondary?: { text: string; action: 'restore' | 'backup' };
}

export function syncPromptFor(s: SyncSituation): SyncPrompt {
  if (s.cloudHasBackup && s.localCourses > 0) {
    return {
      kind: 'both',
      title: '要同步哪一份？',
      lead: '云端已经有一份备份，本机也有 ' + s.localCourses + ' 门课。两边只能留一份 —— 选哪个都会覆盖另一边，所以先问清楚。',
      primary: { text: '用云端覆盖本机', action: 'restore' },
      secondary: { text: '把本机传上去', action: 'backup' },
    };
  }
  if (s.cloudHasBackup) {
    return {
      kind: 'restore',
      title: '把云端的课表恢复到本机？',
      lead: '本机现在没有课表，云端有一份备份。恢复会写入本机（这一步可以撤销）。',
      primary: { text: '恢复到本机', action: 'restore' },
    };
  }
  if (s.localCourses > 0) {
    return {
      kind: 'backup',
      title: '把本机课表备份到云端？',
      lead: '云端还没有你的备份。现在备份一份，换设备登录后就能一键恢复。',
      primary: { text: '备份到云端', action: 'backup' },
    };
  }
  return { kind: 'none', title: '', lead: '' };
}
