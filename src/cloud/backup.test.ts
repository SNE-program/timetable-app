import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT, BACKUP_VERSION, HARD_LIMIT_BYTES, BackupError, buildBackup, buildBackupWithinLimit,
  byteLength, describeBackup, formatTime, validateBackup,
} from './backup';
import { defaultTheme } from '../theme/tokens';
import { buildDemoData } from '../core/demo';

/**
 * 备份内容的测试。
 *
 * 这里要钉死的是三件事：
 *   1. 备份里**有什么、没有什么**（白名单，角色不进备份）；
 *   2. 体积判断用的是**字节**不是字符数（一份课表全是中文，拿 length 当字节会低估三倍，
 *      上线后才发现"服务器拒收"是最糟的）；
 *   3. 云端拿回来的东西必须先校验再用 —— 别的应用往同一张表里写过东西时，
 *      不能把一坨不明结构直接写进本机课表。
 */

function demoPrefs(): Parameters<typeof buildBackup>[0]['prefs'] {
  return {
    reminderOffsets: [15, 5], dailyBrief: true, briefHour: 21,
    studioLocked: true, confirmDestructive: true,
    permissionAsked: true, privacySeen: true, autoCheckUpdate: true, autoLogin: true, debug: true,
    mascot: { size: 140, x: 0.8, y: 0.6, fps: 0, facing: 'right', hidden: false },
  };
}

function build(withAssets = true) {
  return buildBackup({
    data: buildDemoData(),
    prefs: demoPrefs(),
    theme: defaultTheme(),
    appVersion: '1.6.0-test',
    device: 'Windows',
    withAssets: withAssets,
  });
}

describe('云备份内容', function () {
  it('带上了课表、外观与偏好，且标了格式与版本', function () {
    const p = build();
    expect(p.format).toBe(BACKUP_FORMAT);
    expect(p.version).toBe(BACKUP_VERSION);
    expect(p.app_version).toBe('1.6.0-test');
    expect(p.data.courses.length).toBeGreaterThan(0);
    expect(p.data.sessions.length).toBeGreaterThan(0);
    expect(p.theme).toBeTruthy();
    expect(p.stats.courses).toBe(p.data.courses.length);
    expect(p.stats.bytes).toBeGreaterThan(0);
  });

  it('偏好走白名单：本机专用项与角色都不进备份', function () {
    const p = build();
    expect(p.prefs.reminderOffsets).toEqual([15, 5]);
    expect(p.prefs.dailyBrief).toBe(true);
    /* 这几项要么是"这台设备的事"，要么体积大且有自己的文件格式 */
    expect('mascot' in p.prefs).toBe(false);
    expect('privacySeen' in p.prefs).toBe(false);
    expect('permissionAsked' in p.prefs).toBe(false);
    expect('debug' in p.prefs).toBe(false);
  });

  it('摘要是一句人话，且含门课数与体积', function () {
    const s = describeBackup(build());
    expect(s).toContain('门课');
    expect(s).toMatch(/KB|MB|B/);
    expect(s).toContain('不含图片');
  });

  it('中文按 3 字节算 —— 字节数不能拿 length 顶替', function () {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('课表')).toBe(6);
    const p = build();
    const json = JSON.stringify(p);
    expect(p.stats.bytes).toBe(byteLength(json));
    /* 中文占比很高，字节数应当明显大于字符数 */
    expect(p.stats.bytes).toBeGreaterThan(json.length);
  });
});

describe('体积上限', function () {
  it('没有图片时不会谎报"图片被丢掉"', function () {
    const r = buildBackupWithinLimit({
      data: buildDemoData(), prefs: demoPrefs(), theme: defaultTheme(), appVersion: 't', device: 'Windows',
    });
    expect(r.payload.stats.assets).toBe(0);
    expect(r.droppedAssets).toBe(false);
    expect(r.payload.stats.bytes).toBeLessThan(HARD_LIMIT_BYTES);
  });
});

describe('恢复前的校验', function () {
  it('拒绝不是备份的东西', function () {
    expect(function () { validateBackup(null); }).toThrow(BackupError);
    expect(function () { validateBackup({ hello: 1 }); }).toThrow('这不是课表助手的云备份');
    expect(function () { validateBackup({ format: BACKUP_FORMAT, version: 1 }); }).toThrow('没有课表数据');
  });

  it('拒绝来自更高版本的备份', function () {
    expect(function () {
      validateBackup({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1, data: { courses: [] } });
    }).toThrow('更新的版本');
  });

  it('拒绝结构不完整的课表（缺学期 / 时段 / 作息）', function () {
    expect(function () {
      validateBackup({ format: BACKUP_FORMAT, version: 1, data: { courses: [], sessions: [] } });
    }).toThrow('备份不完整');
  });

  it('合法的备份能原样取回', function () {
    const p = build();
    const back = validateBackup(JSON.parse(JSON.stringify(p)));
    expect(back.data.courses.length).toBe(p.data.courses.length);
    expect(back.stats.courses).toBe(p.stats.courses);
  });

  it('缺字段的老备份也能读（给默认值而不是崩掉）', function () {
    const back = validateBackup({
      format: BACKUP_FORMAT, version: 1,
      data: { courses: [], sessions: [], schemes: [], term: { name: 'x' } },
    });
    expect(back.assets).toEqual({});
    expect(back.app_version).toBe('');
    expect(describeBackup(back)).toContain('0 门课');
  });
});

describe('时间显示', function () {
  it('本地时间到分钟；坏值不抛异常', function () {
    expect(formatTime('2026-09-12T00:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatTime('')).toBe('时间未知');
    expect(formatTime('nonsense')).toBe('时间未知');
  });
});
