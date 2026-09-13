import React from 'react';
import {
  confirmDanger, importMascotPack, openMascotCenter, patchMascotPrefs, patchPrefs, removeMascot,
  repairMascotFrames, resetMascotPosition, showToast, useApp,
} from '../app/store';
import { exportMascotPackFile, importMascotMedia, importMascotPackFile, pickFile } from './mascotImport';
import { inspectMascot, needsFix, type MascotFinding } from '../mascot/inspect';
import { describeAsset, providedStates } from '../mascot/pack';
import { HEIGHT_MAX, HEIGHT_MIN, MASCOT_STATES, STATE_LABEL } from '../mascot/types';
import { saveTextFile } from '../platform/saveFile';
import { Panel, Sheet, SliderRow, SwitchRow } from './common';
import MascotArt from './MascotArt';
import MascotThumb from './MascotThumb';
import { cloudConfigured } from '../cloud/config';


/**
 * 「角色」面板。
 *
 * 设计前提：**默认什么都没有**。所以这个面板大部分时候显示的是一个空状态 ——
 * 它得把"这是什么、怎么弄一个、去哪看教学"三件事说清楚，
 * 而不是摆一堆禁用状态的控件。
 *
 * 这也是它和外观页其它面板的区别：其它面板是"调参数"，这个是"先得有素材"。
 * 不会用的人会卡在第一步，所以教学入口必须显眼。
 */
export default function MascotPanel() {
  const s = useApp();
  const pack = s.mascot;
  const mp = s.prefs.mascot;
  const [busy, setBusy] = React.useState(false);
  /** 粘贴角色包：相册里没有 .json，这是没有文件管理器时唯一的路 */
  const [paste, setPaste] = React.useState(false);
  const [pasted, setPasted] = React.useState('');
  /** 滑杆的临时值：拖动时只更新它，停手后才写盘 */
  const [sizeDraft, setSizeDraft] = React.useState(mp.size);
  /** 上一次导入的结果（帧数、单格多大、有没有空白格）—— 只弹一次提示太容易错过 */
  const [report, setReport] = React.useState<{ summary: string; notes: string[] } | null>(null);
  /** 检查结果 */
  const [findings, setFindings] = React.useState<MascotFinding[] | null>(null);
  const [checking, setChecking] = React.useState(false);

  /* 外部（换个角色、恢复默认）改了尺寸要同步回来 */
  React.useEffect(function () { setSizeDraft(mp.size); }, [mp.size]);

  React.useEffect(function () {
    if (sizeDraft === mp.size) return;
    const id = window.setTimeout(function () { patchMascotPrefs({ size: sizeDraft }); }, 400);
    return function () { window.clearTimeout(id); };
  }, [sizeDraft, mp.size]);

  /**
   * 导入的两条路（角色包 / 图或视频）都走 ui/mascotImport.ts 里那份共用实现 ——
   * 角色中心用的是同一份，所以"从面板导入"和"从角色中心导入"不会有行为差别。
   */
  /** 这个角色提供了哪几种状态（面板头像下面那一行） */
  const states = pack ? providedStates(pack) : [];

  async function pickAndImportPack(): Promise<void> {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    setBusy(true);
    try {
      await importMascotPackFile(f);
    } finally {
      setBusy(false);
    }
  }

  async function pickAndImportMedia(): Promise<void> {
    const f = await pickFile('image/*,video/*');
    if (!f) return;
    setBusy(true);
    setReport(null);
    try {
      /* 导入结果就地留一份：只弹一个提示条太容易错过（帧数、每帧多大都是判断依据） */
      setReport(await importMascotMedia(f, mp.size));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 移除角色：**先问一句**。
   *
   * 这一下会连带把素材从本机清掉（再想要得重新导入），属于不可逆操作；
   * 用户这一轮的要求正是"角色设置也要防误触"，所以除了面板锁定之外，
   * 这里再走一次应用统一的危险操作确认（设置里可以关掉它）。
   */
  async function removeMascotAsk(): Promise<void> {
    const ok = await confirmDanger('移除这个角色？它的素材会一起从本机清掉，重新导入才能恢复。', '移除');
    if (!ok) return;
    removeMascot();
    showToast('已移除角色', 'ok');
  }

  /** 检查：把"每帧多大、真有几帧、会不会虚"量出来给用户看 */
  async function runCheck(): Promise<void> {
    if (!pack) return;
    setChecking(true);
    try {
      setFindings(await inspectMascot(pack, { displayHeight: mp.size, dpr: window.devicePixelRatio || 1 }));
    } finally {
      setChecking(false);
    }
  }

  async function applyFramesFix(): Promise<void> {
    const n = await repairMascotFrames(true);
    if (n === 0) {
      showToast('实测下来这个角色的帧数没问题，不用改', 'info');
    }
    await runCheck();
  }

  /* 导出走共用实现（角色中心里那个按钮用的是同一份） */
  async function exportPack(): Promise<void> {
    await exportMascotPackFile();
  }

  /*
   * 角色设置也吃外观锁定。
   *
   * 原来这里是**豁免**的，理由是"导入角色是数据操作，不是调样式"；
   * 但豁免以后「移除角色」「替换素材」「放回默认位置」这些**同样能一键改掉已有角色**的行
   * 也跟着敞着 —— 锁着外观的时候照样点得动，其中「移除角色」会连带清掉素材。
   * 现在只有"还没有角色"时不锁（那时唯一的动作就是第一次把它放进来）。
   */
  const locked = s.prefs.studioLocked !== false && !!pack;

  return (
    <React.Fragment>
      {/*
        提示条放在 Panel **外面**：锁定时面板整体会压暗、里面的按钮一律点不动，
        而这条提示自己得是亮的、按钮得能按 —— 否则用户只看到一片点不动的行，
        不知道该去哪解锁（顶部那条锁定栏在面板多的时候早滚出屏幕了）。
      */}
      {locked ? (
        <div className="studio-lock on inline">
          <div className="studio-lock-text">
            <div className="studio-lock-title">角色设置已锁定</div>
            <div className="studio-lock-sub">和外观一样，锁定状态下点不动 —— 防止误触改掉或移除已有角色</div>
          </div>
          <button
            className="btn sm primary"
            onClick={function () {
              patchPrefs({ studioLocked: false });
              showToast('已解锁，可以改角色设置了', 'ok');
            }}
          >解锁</button>
        </div>
      ) : null}
    <Panel
      title="角色"
      sub={pack ? pack.name : '未设置'}
      desc="放在课表界面上的一个小东西：会呼吸、会眨眼，点一下有反应，可以拖着换位置。默认不显示 —— 导入一个角色包才会出现。"
    >
      {/*
        文件选择改成"用到时才创建 input"（见 ui/mascotImport.ts 的 pickFile）。
        两个常驻的隐藏 input 有两个问题：一是取消选择时不会触发 change，
        界面会一直以为"正在导入"；二是同一段逻辑在角色中心里要再写一遍。
      */}

      {/*
        有角色时：左边放一个**活的**角色（和桌面上同一个渲染组件），右边是名字与来源。
        比一行文字说明好看得多，也让人一眼确认这是不是自己想要的那个。
      */}
      {pack ? (
        <div className="mascot-hero">
          <div className="mascot-hero-stage">
            <MascotArt
              asset={pack.states.idle!}
              motion={pack.motion}
              phase="idle"
              size={72}
              shadow={pack.shadow}
            />
          </div>
          <div className="mascot-hero-meta">
            <div className="lr-label">{pack.name}</div>
            <div className="lr-sub">
              {pack.author ? pack.author + ' · ' : ''}
              {states.map(function (k) { return STATE_LABEL[k]; }).join(' / ')}
            </div>
            <div className="lr-sub">{pack.description || (mp.hidden ? '当前已收起来' : '正在课表界面上')}</div>
          </div>
          <div className="lr-right">
            <MascotThumb asset={pack.states.idle} size={44} />
          </div>
        </div>
      ) : null}

      {/*
        四个槽位。空着的时候是虚线加号：它同时干两件事 ——
        告诉用户一个角色由这四部分组成，以及点这里就能开始做。
      */}
      {/* 纯展示，不做成可点 —— 可点的话它就是一排按钮，面板立刻又乱了 */}
      <div className="mascot-slots">
        {MASCOT_STATES.map(function (k) {
          const a = pack ? pack.states[k] : undefined;
          return (
            <div className="mascot-slot" key={k}>
              {a ? <MascotThumb asset={a} />
                : <div className="mascot-thumb is-empty mascot-slot-add" style={{ height: '48px' }}>＋</div>}
              <div className="mascot-slot-name">{STATE_LABEL[k]}</div>
              <div className="mascot-slot-sub">{a ? '已设置' : (k === 'idle' ? '必填' : '留空')}</div>
            </div>
          );
        })}
      </div>

      {/*
        导入结果就地留一份。
        只弹一个 toast 太容易错过：帧数、每帧多大像素、"会不会发虚"这些数字，
        用户想回头再看一眼时 toast 早没了 —— 而它们正是判断"这个角色行不行"的依据。
      */}
      {report ? (
        <div className="warn-bar" style={{ margin: '0 14px 10px' }}>
          <div className="warn-badge">{report.notes.length ? '!' : '✓'}</div>
          <div>
            <div className="warn-item" style={{ color: 'var(--c-text)', marginTop: 0 }}>{report.summary}</div>
            {report.notes.map(function (n, i) {
              return <div className="warn-item" key={i}>{n}</div>;
            })}
          </div>
        </div>
      ) : null}

      {/*
        所有"能改东西"的行都关在这个容器里，由外观锁定统一管（见 components.css）。
        还没有角色时容器带 .unlocked —— 那一步（第一次把角色放进来）不该被锁拦住。
      */}
      <div className={'mascot-rows' + (pack ? '' : ' unlocked')}>
      {/* 只留一个主入口，其余全收进「更多功能」 */}
      <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void pickAndImportPack(); }}>
        <div>
          <div className="lr-label">导入角色包</div>
          <div className="lr-sub">选一个 .json 文件；内容也支持整段粘贴</div>
        </div>
        <div className="lr-right">›</div>
      </div>
      {/*
        角色的其它动作全部移到了「角色中心」（选 / 做 / 分享三页）。
        原来这里是一个「更多功能」折叠区，里面塞了七行 —— 展开之后比不展开更乱，
        而且用户想"换一个角色"时得先在折叠区里找。
      */}
      <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { openMascotCenter(); }}>
        <div>
          <div className="lr-label">角色中心</div>
          <div className="lr-sub">换一个 · 做一个 · 分享与获取 —— 角色的所有功能都在这里</div>
        </div>
        <div className="lr-right">›</div>
      </div>

      {/* 「检查这个角色」留在面板里：它是排错用的，不是日常动作 */}
      {pack ? (
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void runCheck(); }}>
          <div>
            <div className="lr-label">检查这个角色</div>
            <div className="lr-sub">量一遍：每帧多大、真有几帧、会不会被放大发虚</div>
          </div>
          <div className="lr-right">{checking ? '…' : '›'}</div>
        </div>
      ) : null}
      {pack ? (
        <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { void removeMascotAsk(); }}>
          <div>
            <div className="lr-label" style={{ color: 'var(--c-danger)' }}>移除角色</div>
            <div className="lr-sub">素材会一起从本机清掉（角色库里的副本不受影响）；重新导入即可恢复</div>
          </div>
          <div className="lr-right">›</div>
        </div>
      ) : null}
      </div>

      {pack ? (
        <React.Fragment>
          <div className="panel-desc" style={{ paddingBottom: 6 }}>
            角色只在课表页出现（本周 / 今日 / 任务）—— 外观页和设置页是拿来调东西的，
            那里不摆它。它可以一路拖到只剩落脚点在屏幕里（一半挂在边上也没关系），
            拖到不顺手的地方随时「放回默认位置」。
          </div>
          <div style={{ padding: '0 14px' }}>
            <SliderRow
              label="大小"
              value={sizeDraft}
              min={HEIGHT_MIN}
              max={HEIGHT_MAX}
              step={4}
              format={function (v) { return v + ' px'; }}
              onChange={function (v) {
                /* 拖动过程中只改界面，松手 400ms 后才落盘 —— 否则滑一下就是几十次 localStorage 写入 */
                setSizeDraft(v);
              }}
            />
            {/*
              播放帧率。
              做成"偏好"而不是改角色包：素材是怎么抽的就该记什么，观看快慢是个人的事，
              导出给别人时不该把别人的包带上我的速度。
            */}
            <SliderRow
              label="播放帧率"
              value={mp.fps}
              min={0}
              max={24}
              step={1}
              format={function (v) {
                if (v === 0) {
                  const own = pack.states.idle && pack.states.idle.fps ? pack.states.idle.fps : 8;
                  return '跟随素材（' + own + ' fps）';
                }
                return v + ' fps';
              }}
              onChange={function (v) { patchMascotPrefs({ fps: v }); }}
            />
            <div className="panel-desc" style={{ padding: '2px 0 10px' }}>
              调高它只会<b>播得更快</b>，不会更顺 —— 画面里的帧就那么多。
              想让动作真正更顺，重新导入那段视频即可（现在默认按 18fps 抽帧，以前是 12）。
            </div>
          </div>
          <div className="list-row tap" style={{ cursor: 'pointer' }} onClick={function () { resetMascotPosition(); showToast('已放回默认位置', 'ok'); }}>
            <div>
              <div className="lr-label">放回默认位置</div>
              <div className="lr-sub">拖到边上、拖出屏幕、换了设备之后，点这里一步复位</div>
            </div>
            <div className="lr-right">›</div>
          </div>
          {/*
            朝向。默认按"素材朝右"处理：走动往左时会水平镜像，让它朝着前进方向。
            素材本身朝左的（不少立绘是），勾上这一条基准就正过来了。
          */}
          <SwitchRow
            label="素材本身朝左"
            sub="勾上之后走动时的朝向会反过来；默认按「素材朝右」处理"
            on={mp.facing === 'left'}
            onChange={function (v) { patchMascotPrefs({ facing: v ? 'left' : 'right' }); }}
          />
          <SwitchRow
            label="暂时收起来"
            sub="收起来之后不会再出现，直到你在这里取消勾选"
            on={mp.hidden}
            onChange={function (v) { patchMascotPrefs({ hidden: v }); }}
          />
          <div className="list-row">
            <div>
              <div className="lr-label">交互</div>
              <div className="lr-sub">
                {pack.interactive.click ? '点一下有反应' : '不响应点击'}
                {' · '}
                {pack.interactive.drag ? '可以拖动换位置' : '位置固定'}
                {'（由角色包决定）'}
              </div>
            </div>
          </div>
        </React.Fragment>
      ) : (
        <div className="panel-desc" style={{ paddingTop: 4 }}>
          应用不内置任何角色、也不提供下载渠道。素材从哪来是你自己的事，
          这里只负责在本机把它显示出来 —— 不上传、不联网。
        </div>
      )}

      {/*
        粘贴导入。
        相册里永远不会有 .json —— 手机上只给了相册权限时，"导入角色包"这条路是断的。
        粘贴一段文本就能绕开：同学发到微信里的内容直接复制过来即可。
      */}
      {/* 检查结果：把量到的事实一条条摆出来，需要动手的地方直接给按钮 */}
      {findings ? (
        <Sheet title="角色检查" onClose={function () { setFindings(null); }}>
          <div className="panel-desc" style={{ padding: '0 0 10px' }}>
            下面是这台设备上量出来的事实。判断"清不清楚"的算法很简单：
            显示高度 × 屏幕倍率 = 需要的物理像素（当前 {mp.size}px ×{' '}
            {Math.round((window.devicePixelRatio || 1) * 10) / 10} 倍）。
          </div>
          {findings.map(function (f, i) {
            return (
              <div className="list-row" key={i} style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="lr-label">{f.label}</div>
                  <div
                    className="lr-sub"
                    style={f.level === 'bad' ? { color: 'var(--c-danger)' } : undefined}
                  >{f.text}</div>
                </div>
              </div>
            );
          })}
          {needsFix(findings) ? (
            <button
              className="btn primary block" style={{ marginTop: 10 }}
              disabled={checking}
              onClick={function () { void applyFramesFix(); }}
            >按实测帧数修正</button>
          ) : null}
          <div className="panel-desc" style={{ paddingTop: 10 }}>
            检查只读，不会联网、也不会上传任何东西；点「修正」只会改本机角色包里那个帧数。
          </div>
        </Sheet>
      ) : null}

      {paste ? (
        <Sheet title="粘贴角色包" onClose={function () { setPaste(false); }}>
          <div className="panel-desc" style={{ padding: '0 0 10px' }}>
            把角色包的内容整段粘到下面。以 {'{'} 开头的一大段 JSON 就是，
            多几个换行也没关系。
          </div>
          <textarea
            className="input share-box"
            value={pasted}
            placeholder={'{"format":"timetable-mascot", … }'}
            spellCheck={false}
            autoComplete="off"
            onChange={function (e) { setPasted(e.target.value); }}
          />
          <button
            className="btn primary block" style={{ marginTop: 10 }}
            disabled={pasted.trim().length < 10}
            onClick={function () {
              /* 粘贴这条路和文件那条走同一个校验（store 里的 importMascotPack） */
              const r = importMascotPack(pasted, '粘贴的角色');
              if (!r.ok) { showToast('导入失败：' + r.error, 'error'); return; }
              setPaste(false);
              setPasted('');
              showToast('角色已就位，按住它可以拖到别的位置', 'ok');
            }}
          >导入</button>
          <div className="panel-desc" style={{ paddingTop: 10 }}>
            角色包是纯数据，粘进来的内容只会被当成参数读，不会执行任何代码。
          </div>
        </Sheet>
      ) : null}
    </Panel>
    </React.Fragment>
  );
}
