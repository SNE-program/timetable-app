import React from 'react';
import { copyText } from '../app/asyncAction';
import { showToast } from '../app/store';

/**
 * 渲染错误围栏。
 *
 * ## 为什么必须有
 *
 * React 在渲染期遇到异常会**卸载整棵树**，用户看到的就是一片白 ——
 * 没有报错、没有按钮、连"出错了"三个字都没有。这是最糟的失败方式：
 * 用户唯一能做的就是卸载重装，而开发者连是哪一步炸的都无从得知。
 *
 * v0.13.0 就出过一次这种事：角色面板里一个条件执行的 hook（React #300），
 * 点一下「暂时收起来」整个应用变白屏。**构建通过、单测全绿、布局检查也看不出来**，
 * 只有真的点下去才会炸。这个围栏就是为了让那类问题下次表现为一张能读的错误卡片。
 *
 * ## 两种用法
 *
 *   - 包住整个应用（main.tsx）：兜住任何一处渲染异常，并把错误信息露出来；
 *   - 包住单个功能（角色）：**装饰性功能永远不该有能力搞白主功能**，
 *     所以它单独一层，而且带"移除角色"这种一键回退。
 */
interface Props {
  /** 出错时显示的名字，例如"角色" */
  label: string;
  children: React.ReactNode;
  /** 用户点"重试"之前要做的事（比如关掉出问题的面板） */
  onRetry?: () => void;
  /** 额外的一键回退入口，例如"移除角色" */
  extraAction?: { text: string; run: () => void };
  /** 出错时的兜底层级：整个应用出错时显示大卡片，功能级出错时显示小条 */
  full?: boolean;
}

interface State { error: Error | null; info: string }

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, info: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error: error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    /* 控制台留一份完整堆栈：用户复制的是人话，开发者要的是这个 */
    console.error('[' + this.props.label + '] 渲染出错：', error, info.componentStack);
    this.setState({ info: String((info && info.componentStack) || '') });
  }

  private retry = (): void => {
    this.setState({ error: null, info: '' });
    if (this.props.onRetry) this.props.onRetry();
  };

  private runExtra = (): void => {
    if (this.props.extraAction) this.props.extraAction.run();
    this.setState({ error: null, info: '' });
  };

  private copy = (): void => {
    const e = this.state.error;
    const lines = [
      '位置：' + this.props.label,
      '错误：' + (e && e.message ? e.message : String(e)),
      '时间：' + new Date().toISOString(),
      '',
      '组件栈：',
      this.state.info,
      '',
      '版本：' + (typeof window !== 'undefined' ? (window.location.search || '(无参数)') : ''),
    ];
    void copyText(lines.join('\n')).then(function (ok) {
      showToast(ok ? '错误信息已复制' : '复制失败，可以截图', ok ? 'ok' : 'warn');
    });
  };

  render(): React.ReactNode {
    const e = this.state.error;
    if (!e) return this.props.children;

    const body = (
      <React.Fragment>
        <div className="crash-title">{this.props.label}出了点问题</div>
        <div className="crash-msg">{e.message || String(e)}</div>
        <div className="check-actions" style={{ borderTop: 0, paddingTop: 8, flexWrap: 'wrap' }}>
          <button className="btn sm primary" onClick={this.retry}>重试</button>
          <button className="btn sm" onClick={this.copy}>复制错误信息</button>
          {this.props.extraAction ? (
            <button className="btn sm" onClick={this.runExtra}>{this.props.extraAction.text}</button>
          ) : null}
        </div>
        <div className="panel-desc" style={{ paddingTop: 8 }}>
          这不影响你的课表数据 —— 数据存在本机，随时可以在设置里导出备份。
          {this.props.full ? '如果一直进不来，重启一次应用；还不行就把上面那段错误信息发出来。' : ''}
        </div>
      </React.Fragment>
    );

    if (this.props.full) {
      return (
        <div className="crash-full">
          <div className="crash-card">{body}</div>
        </div>
      );
    }
    return <div className="crash-inline">{body}</div>;
  }
}
