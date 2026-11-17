import type { ReactNode } from 'react';
import type { ScreenPanelState } from '../api/devices-draft';
import { formatClock } from './format';

/**
 * 单设备「查看屏幕 / 停止查看」面板（W13，消费v0.2.0-draft媒体会话状态机）。
 *
 * 诚实边界：
 * - `wired=false`（正式页面当前态）：媒体合同草案未冻结、Server媒体授权/传输未部署——
 *   按钮禁用并说明，**不渲染任何画面元素**，不以静态截图/占位图冒充实时投屏。
 * - `wired=true` 时画面区只承载真实传输挂载点，状态由服务端媒体会话状态机驱动
 *   （authorized→negotiating→active→stopping→stopped|failed|abandoned），
 *   active 态显示客户端四层证据（包到达/出帧/渲染/声音分开计数）——
 *   四层证据缺席时显示「证据未知」，不以「会话已建立」冒充出帧。
 */
export function ScreenViewPanel(props: {
  clientId: string;
  deviceId: string;
  state: ScreenPanelState;
  /** 接线后由传输层注入的真实画面挂载点（video/canvas）；非active态不渲染 */
  children?: ReactNode;
  onStart?: () => void;
  onStop?: () => void;
}): React.JSX.Element {
  const { state } = props;
  const testId = `screen-panel-${props.clientId}-${props.deviceId}`;

  if (!state.wired) {
    return (
      <div className="card card-notwired" data-testid={testId}>
        <p>
          「查看屏幕」尚未接入：媒体会话与传输合同 <code>v0.2.0</code> 尚未部署媒体授权端点（媒体为定义面、传输未落地的部分如实标注）
          （且媒体授权不因只读列表自动获得）。冻结部署后此处为真实投屏画面，不会显示录屏文件或占位图冒充实时。
        </p>
        <div className="writes-bar">
          <button type="button" disabled title="媒体合同未冻结、传输未部署，查看屏幕保持不可用">
            查看屏幕
          </button>
          <button type="button" disabled title="媒体合同未冻结、传输未部署">
            停止查看
          </button>
        </div>
      </div>
    );
  }

  const statusText: Record<NonNullable<ScreenPanelState['sessionStatus']>, string> = {
    authorized: '已授权——等待Client建立传输',
    negotiating: '协商中——等待Client出站连接',
    active: '投屏中',
    stopping: '停止中',
    stopped: '已停止',
    failed: state.error ? `投屏失败：${state.error}` : '投屏失败',
    abandoned: '授权已超时放弃',
    unknown: '证据未知——会话状态不可确认，不做复活',
  };
  const sessionStatus = state.sessionStatus ?? 'unknown';

  return (
    <div className="card" data-testid={testId}>
      <div className="row-head">
        <strong>屏幕查看</strong>
        <span className="muted">{statusText[sessionStatus]}</span>
      </div>

      {/* 画面区：仅 active 态承载真实传输挂载点（video由接线方注入）；
          证据缺席或非active时显示明确说明，占位区不含任何图像/视频内容 */}
      {(sessionStatus === 'active' || sessionStatus === 'stopping') && props.children ? (
        <div className="screen-frame" data-testid={`${testId}-mount`}>
          {props.children}
        </div>
      ) : (
        <div className="screen-frame screen-frame-empty" data-testid={`${testId}-empty`}>
          <p className="muted">
            {sessionStatus === 'active'
              ? '会话已激活，但客户端证据尚未上报——画面未确认，不以会话建立冒充出帧。'
              : '当前无画面传输。'}
          </p>
        </div>
      )}

      {state.evidenceLayers != null && (
        <p className="muted" data-testid={`${testId}-evidence`}>
          四层证据（客户端上报）：包到达 {state.evidenceLayers.packetReceived ?? '未知'} ·
          解码出帧 {state.evidenceLayers.decodedFrames ?? '未知'} ·
          已渲染 {state.evidenceLayers.rendered ?? '未知'} ·
          声音播放 {state.evidenceLayers.audioPlayed ?? '未知'}
          {state.lastEvidenceAt ? `；最近证据 ${formatClock(state.lastEvidenceAt)}` : ''}
        </p>
      )}

      <div className="writes-bar">
        <button
          type="button"
          onClick={() => props.onStart?.()}
          disabled={sessionStatus === 'active' || sessionStatus === 'negotiating' || sessionStatus === 'stopping'}
          title="发起媒体会话须经服务端授权，本面板不绕过"
        >
          查看屏幕
        </button>
        <button
          type="button"
          onClick={() => props.onStop?.()}
          disabled={sessionStatus === 'stopped' || sessionStatus === 'failed' || sessionStatus === 'abandoned'}
          title="停止即向服务端登记停止，不再接收/转发该路媒体"
        >
          停止查看
        </button>
      </div>
    </div>
  );
}
