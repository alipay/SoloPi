import {flushSync} from 'react-dom';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getMediaLoginState,
  mvAuthorize,
  mvStop,
  mvStatus,
  subscribeMediaLogin,
  type MvAuthorizeResponse,
} from '../api/media-viewer';
import {recoverableMediaClose} from '../api/media-recovery';
import {mediaObservation} from '../api/media-observation';
import { ApiError } from '../api/http';
import { viewerWsUrl } from '../media/h264-annexb';
import { MediaViewerPipeline, type ViewerEvidence, type ViewerPipelineState } from '../media/MediaViewerPipeline';

/**
 * 单设备媒体查看面板（W20 接线，服务端 v0.2.1 r6 免口令）。
 *
 * 真实状态语义（不冒充）：
 * - 授权判定全部以服务端实际响应为准（401 主体未建立/cookie过期、403 异主体/权限、422 设备/字段无效）；
 * - 用户 2026-11-06 决定 + Server v0.2.1 r6（commit 451ff54c604d…）：观看免口令。
 *   本站无任何密码/口令输入面（W23fix3 已删表单与拦截）。发起观看时如探测结论非「ok」
 *   （无 cookie / 过期 / 未知）即自动空 body 建立/重建观看主体（POST /mv/session {}），
 *   携同站 cookie 继续 authorize；authorize 401 时**至多再重建主体一次**（有界重试，
 *   绝不无限循环）；403 权限拒绝不重试不当成功，422 如实显示——所有错误都是真实
 *   服务端状态，不猜测、不冒充已授权；
 * - 「投屏中」仅当浏览器已真实呈现解码帧（WebCodecs rendered 计数>0）；
 * - 解码/呈现/首帧耗时是浏览器本地观测证据，与传输握手分开显示；
 * - 关闭=本地释放 + 服务端 mvStop；页面卸载兜底释放；
 * - 换会话主体不能停他人旧会话（服务端语义）——403 如实显示。
 */

type ActiveUi =
  | { kind: 'idle' }
  | { kind: 'authorizing' }
  | { kind: 'live'; mediaSessionId: string; pipeline: ViewerPipelineState; evidence: ViewerEvidence }
  | { kind: 'ended'; reason: string };

const stateText = (s: ViewerPipelineState): string => {
  switch (s.kind) {
    case 'connecting':
      return 'WSS 握手中…';
    case 'connected':
      return '已连接——等待Client出流（首帧未到不冒充投屏）';
    case 'presenting':
      return '投屏中（浏览器已呈现解码帧）';
    case 'no-first-frame':
      return `已连接 ${s.waitedMs}ms 仍无首帧——Client 未上线或尚未采集，不显示画面`;
    case 'unsupported':
      return `此浏览器不支持解码：${s.reason}`;
    case 'error':
      return `解码错误：${s.message}`;
    case 'disconnected':
      return `连接已断开${s.code != null ? `（关闭码 ${s.code}${s.reason ? `：${s.reason}` : ''}）` : ''}`;
    case 'stopped':
      return '已停止并释放';
  }
};

export function MediaViewerPanel(props: {
  clientId: string;
  deviceId: string;
  deviceName?: string | null;
  deviceOnline: boolean | null;
  /** Client 声明的媒体能力（capabilities.media）——false 时如实禁用 */
  mediaCapable: boolean;
  autoStart?: boolean;
  compact?: boolean;
  showZoomControl?: boolean;
}): React.JSX.Element {
  const { clientId, deviceId } = props;
  const testId = `media-viewer-${clientId}-${deviceId}`;
  const loginState = useSyncExternalStore(subscribeMediaLogin, getMediaLoginState);
  const [active, setActive] = useState<ActiveUi>({ kind: 'idle' });
  const [authHint, setAuthHint] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipelineRef = useRef<MediaViewerPipeline | null>(null);
  const observationRef=useRef<ReturnType<typeof mediaObservation>|null>(null);
  const sessionRef = useRef<string | null>(null);
  // C41-4：授权流代次——stop/卸载递增；迟到的authorize按失配丢弃并撤回已授权会话
  const flowSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const reconnectCount = useRef(0);
  const manualStop = useRef(false);
  const restartRef = useRef<()=>void>(()=>{});
  const [reconnecting,setReconnecting] = useState<number|null>(null);

  useEffect(() => {

  }, []);

  // 卸载/收起兜底：任一退出路径都本地释放并尽力通知服务端停止（幂等）；
  // 同时递增授权流代次——在飞的authorize落地后按失配丢弃并撤回其创建的会话（C41-4 迟授权取消）；
  // C45-B8：StrictMode开发态 effect 重放（setup→cleanup→setup）会先跑一次cleanup——
  // setup必须复位 mountedRef，否则重挂载后的合法授权被当迟结果撤回
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      observationRef.current?.end('page-exit');
      if(reconnectTimer.current!==null)clearTimeout(reconnectTimer.current);
      flowSeqRef.current += 1;
      const p = pipelineRef.current;
      const sid = sessionRef.current;
      if (p != null) {
        p.stop();
        pipelineRef.current = null;
      }
      if (sid != null) {
        sessionRef.current = null;
        if (document.visibilityState === 'hidden') void mvStop(sid, true);
        else void mvStop(sid);
      }
    };
  }, []);

  const startViewing = useCallback(
    async () => {
      if (!props.mediaCapable) {
        // W22.1：提示与禁用态一致——能力以服务端登记值为准（本页不硬改）；
        // 不默认归因入口接线或打包，建议检查连接/重新建立会话（媒体能力翻转由服务端会话刷新链处理）
        setAuthHint('该 Client 当前登记的媒体能力为未声明（以服务端登记值为准）——可检查 Client 连接状态或重新建立会话后刷新查看最新能力');
        return;
      }
      if (props.deviceOnline === false) {
        setAuthHint('该设备离线（服务端权威状态）——无法发起观看');
        return;
      }
      // C41-4：authorizing期间不接受第二次发起（迟授权/并发授权一律由代次裁决）
      if (active.kind === 'authorizing') return;
      setAuthHint(null);
      manualStop.current=false;
      setZoomHint(null); // 发起新观看时清空上一轮「无画面」提示
      flowSeqRef.current += 1;
      const flowSeq = flowSeqRef.current;
      const stale = () => !mountedRef.current || flowSeq !== flowSeqRef.current;
      const failIdle = (hint: string) => {
        if (stale()) return; // 陈旧流的结果全部丢弃（含迟到授权Cancel——代次裁决）
        setActive({ kind: 'idle' });
        setAuthHint(hint);
      };
      observationRef.current?.end('replaced');
      const observation=mediaObservation(clientId,reconnectCount.current?'recovery':'initial');
      observationRef.current=observation;
      setActive({ kind: 'authorizing' });

      const openLive = (resp: MvAuthorizeResponse) => {
        let presented=false,noFrameReported=false;
        const flowSid = resp.mediaSessionId; // C45-B7：本流会话id随闭包绑定——撤销只指本流
        const url = viewerWsUrl(resp.dataPlane?.pathTemplate ?? '', resp.viewerTicket?.token ?? '');
        if (url == null) {
          // 合同面不符：拒绝连接同时撤回已创建的服务端会话（不占并发位遗留）
          observation.fail('invalid-contract');
          void mvStop(flowSid);
          setActive({ kind: 'idle' });
          setAuthHint('服务端返回的票据/路径不符合合同面——已拒绝发起并停止该会话');
          return;
        }
        observation.authorized();
        sessionRef.current = resp.mediaSessionId;
        // Commit the canvas before scheduling its pipeline. Concurrent rendering
        // may otherwise defer this state update beyond the next animation frame.
        flushSync(() => setActive({
          kind: 'live',
          mediaSessionId: resp.mediaSessionId,
          pipeline: { kind: 'connecting' },
          evidence: { packets: 0, bytes: 0, accessUnits: 0, decodedFrames: 0, renderedFrames: 0, firstFrameMs: null, droppedAUs: 0 },
        }));
        // canvas 已随 live 态挂载后再启动管线。
        // C45-B7：rAF 取消分支不得读共享 sessionRef——旧流的该次会话已在取消点
        // （stopViewing/卸载/resolve失配）被准确处理，这里纯返回即可，绝不误停后来会话
        requestAnimationFrame(() => {
          if (stale()) {
            return;
          }
          const canvas = canvasRef.current;
          if (canvas == null) {
            // 挂载点缺失：仅撤回本流拥有的会话（sessionRef 仍是本流时清理）
            if (sessionRef.current === flowSid) {
              sessionRef.current = null;
              void mvStop(flowSid);
            }
            observation.fail('canvas-missing');
            setActive({ kind: 'idle' });
            setAuthHint('画面挂载点缺失——未发起连接（会话已停止）');
            return;
          }
          const pipeline = new MediaViewerPipeline({
            wssUrl: url,
            canvas,
            firstFrameTimeoutMs: 8_000,
            presentOnAnimationFrame: true,
            bufferEncodedBursts: true,
            onEvent: (event) => {
              // C45-B7：旧管线事件按代次隔离——不得覆盖后续 live 流的状态/证据
              if (stale()) return;
              if (event.type === 'state') {
                setActive((prev) => (prev.kind === 'live' ? { ...prev, pipeline: event.state } : prev));
                if(event.state.kind==='connected')observation.connected();
                if(event.state.kind==='presenting'&&!presented){
                  observation.rendered();
                  presented=true;
                  reconnectCount.current=0;
                }
                if(event.state.kind==='no-first-frame'&&!noFrameReported){
                  observation.timeout();
                  noFrameReported=true;
                }
                if(event.state.kind==='error'||event.state.kind==='unsupported')observation.fail(event.state.kind);
                if (event.state.kind === 'disconnected') {
                  setZoomed(false); // 流断开放大档随流收起
                  const close=event.state;
                  observation.fail('ws_'+(close.code??0));
                  if(sessionRef.current===flowSid)sessionRef.current=null;
                  void (async()=>{
                    let reason=close.reason;
                    // 4409 also means an explicit stop. Never treat every stop as a retry.
                    if([4409,4404].includes(close.code??0)){
                      try{reason=(await mvStatus(flowSid)).endedReason;}catch{reason='status-unavailable';}
                    }
                    void mvStop(flowSid);
                    if(stale())return;
                    observation.reason(`ws_${close.code??0}_${reason??'unknown'}`);
                    if(recoverableMediaClose(close.code,reason)&&props.deviceOnline!==false&&navigator.onLine!==false&&reconnectCount.current<3&&!manualStop.current){
                      const attempt=++reconnectCount.current;setReconnecting(attempt);
                      reconnectTimer.current=setTimeout(()=>{
                        reconnectTimer.current=null;
                        if(stale()||manualStop.current)return;
                        setReconnecting(null);pipelineRef.current?.stop();pipelineRef.current=null;
                        restartRef.current();
                      },2000*2**(attempt-1));
                    }
                  })();
                }
              } else {
                const card=canvas.closest<HTMLElement>('.device-art');
                const shape=canvas.height>canvas.width?'portrait':'landscape';
                if(card && card.dataset.screenShape!==shape)card.dataset.screenShape=shape;
                setActive((prev) => (prev.kind === 'live' ? { ...prev, evidence: event.evidence } : prev));
              }
            },
          });
          pipelineRef.current = pipeline;
          pipeline.start();
        });
      };

      try {
        const resp=await mvAuthorize(clientId,deviceId);
        // C41-4：迟授权取消——发起后已经关闭/卸载/再次点击，则丢弃本次结果并撤回其创建的会话
        if (stale()) {
          void mvStop(resp.mediaSessionId);
          return;
        }
        openLive(resp);
      } catch (err) {
        if (stale()) return;
        observation.fail(err instanceof ApiError?'authorization-http-'+err.status:'authorization-request');
        failIdle(err instanceof ApiError ? `服务端拒绝（HTTP ${err.status}）` : (err as Error).message);
      }
    },
    // C41-4门禁读 active.kind（authorizing期间拒绝二次发起）——active.kind 必须入依赖：
    // probe 在 authorizing 期间 anon→ok 触发回调重建，缺项使陈化闭包固化 active='authorizing'，
    // 关闭后重开按钮 enabled 却零请求（C86/W24.1 复现）；其余判定均走 ref 不受闭包陈化影响。
    [clientId, deviceId, props.deviceOnline, props.mediaCapable, props.autoStart, loginState.probe, active.kind],
  );
  restartRef.current=()=>{void startViewing();};

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!props.autoStart || !props.mediaCapable || props.deviceOnline === false || autoStarted.current) return;
    // Defer until mount effects settle, so StrictMode replay cannot cancel the only start.
    const timer = setTimeout(() => { autoStarted.current = true; void startViewing(); }, 0);
    return () => clearTimeout(timer);
  }, [props.autoStart, props.mediaCapable, props.deviceOnline, startViewing]);

  const stopViewing = useCallback(() => {
    manualStop.current=true;
    observationRef.current?.end('user-stop');
    if(reconnectTimer.current!==null)clearTimeout(reconnectTimer.current);
    reconnectTimer.current=null;setReconnecting(null);
    flowSeqRef.current += 1; // 在飞authorize按失配丢弃；迟授权只会撤回其会话不再开流
    const p = pipelineRef.current;
    if (p != null) {
      p.stop();
      pipelineRef.current = null;
    }
    const sid = sessionRef.current;
    if (sid != null) {
      sessionRef.current = null;
      void mvStop(sid);
    }
    setZoomed(false); // 放大档随本流结束一并收起，不留到下次观看
    setActive((prev) =>
      prev.kind === 'live'
        ? { kind: 'ended', reason: '已手动关闭' }
        : prev.kind === 'authorizing'
          ? { kind: 'ended', reason: '已取消发起（迟到的授权不生效）' }
          : prev,
    );
  }, []);

  const isLive = active.kind === 'live';
  // W24R4：画面放大/还原——纯显示档位切换，仅在本格 frame 上加 .screen-frame-zoomed：
  // 同一 MediaViewerPipeline、同一 canvas、同一媒体会话（不重授权、不重挂载、不 stop），
  // 另一格概览不受影响；退出=Esc 或按钮还原，close/断连/卸载一并收起。
  const [zoomed, setZoomed] = useState(false);
  const [zoomHint, setZoomHint] = useState<string | null>(null);
  const zoomActive = isLive && zoomed;
  const requestZoomExit = useCallback(() => { setZoomed(false); }, []);
  const evidence = isLive ? active.evidence : null;

  return (
    <div className={`mv-panel${props.compact ? ' mv-compact' : ''}`} data-testid={testId} data-live={isLive}>
      <div className="row-head">
        <strong>{props.compact ? '实时屏幕' : '屏幕查看'}</strong>
        <span className="muted" aria-live="polite" data-testid={`${testId}-state`}>
          {isLive
            ? (props.compact ? ({presenting:'实时画面',connecting:'连接中…',connected:'等待画面…','no-first-frame':'暂未收到画面',unsupported:'浏览器暂不支持解码',error:'画面解码失败',disconnected:'画面连接已断开',stopped:'观看已结束'}[active.pipeline.kind]) : stateText(active.pipeline))
            : active.kind === 'authorizing'
              ? '正在向服务端申请观看授权…'
              : active.kind === 'ended'
                ? `查看已结束——${active.reason}`
                : props.deviceOnline === false
                  ? '设备离线——不可发起'
                  : '未在查看'}
        </span>
      </div>

      {loginState.probe === 'not-configured' && !isLive && (
        <p className="muted" data-testid={`${testId}-not-configured`}>
          服务端媒体观看面未配置（HTTP 403 发放面禁用）——本站不提供口令/登录输入，需部署侧开启观看授权后可用。
        </p>
      )}
      {loginState.probe === 'unavailable' && !isLive && (
        <p className="muted" data-testid={`${testId}-unavailable`}>
          当前源未提供同源 /mv 媒体面（本地 dev 或未部署时如此显示）——本处不构造假的可用路径。
        </p>
      )}

      {authHint != null && (
        <p className="mv-hint" data-testid={`${testId}-hint`}>
          {authHint}
        </p>
      )}

      {/* 画面区：仅 live 挂载真实 canvas；非 live 不渲染任何图像/占位图 */}
      {/* W24R4：放大/还原入口——每格独立、始终可见可达；无画面时点击只提示不伪装放大 */}
      {props.showZoomControl!==false && <div className="mv-zoom-bar">
        <button
          type="button"
          className={zoomActive ? 'primary' : ''}
          aria-pressed={zoomActive}
          onClick={() => {
            if (!isLive) {
              setZoomHint('当前无画面传输——请先发起查看；放大仅在观看中生效');
              return;
            }
            setZoomHint(null);
            setZoomed((z) => !z);
          }}
          title={zoomActive ? '还原为组内格大小（不停止观看、不重开流）' : '放大本格画面（同一观看会话内缩放显示，不重授权、不重开流、不影响另一设备）'}
          data-testid={`${testId}-zoom`}
        >
          {zoomActive ? '还原画面' : '放大画面'}
        </button>
        {zoomHint != null && (
          <span className="muted" data-testid={`${testId}-zoom-idle-hint`}>{zoomHint}</span>
        )}
        {zoomActive && (
          <span className="muted" data-testid={`${testId}-zoom-hint`}>
            已放大：同会话同流；Esc 还原，不影响另一设备观看
          </span>
        )}
      </div>
      }
      {props.showZoomControl!==false && isLive && zoomActive && <ZoomEscHandler onExit={requestZoomExit} />}
      {isLive ? (
        <div className={`screen-frame${zoomActive ? ' screen-frame-zoomed' : ''}`} data-testid={`${testId}-mount`} data-pipeline-state={isLive?active.pipeline.kind:undefined}>
          <canvas ref={canvasRef} data-testid={`${testId}-canvas`} />{active.pipeline.kind!=='presenting'&&<div className="mv-frame-status" role="status">{reconnecting!==null?`连接中断，正在重连（${reconnecting}/3）…`:stateText(active.pipeline)}</div>}
        </div>
      ) : (
        <div className="screen-frame screen-frame-empty" data-testid={`${testId}-empty`}>
          <p className="muted">当前无画面传输。</p>
        </div>
      )}

      {(!props.compact || (!isLive && active.kind !== 'authorizing' && authHint != null) || (isLive&&['no-first-frame','disconnected','error'].includes(active.pipeline.kind))) && <div className="writes-bar">
        <button
          type="button"
          onClick={() => {if(isLive)stopViewing();reconnectCount.current=0;void startViewing();}}
          // W22：mediaCapable=false 即呈现禁用态——与authHint一致，取代「可点再报错」的不一致交互
          disabled={!props.mediaCapable || (isLive&&!['no-first-frame','disconnected','error'].includes(active.pipeline.kind)) || active.kind === 'authorizing'}
          title={!props.mediaCapable
            ? '该 Client 当前登记的媒体能力为未声明（以登记值为准）——可检查连接或重新建立会话后查看最新能力'
            : '发起须经服务端 /mv 授权（媒体权限不因只读列表自动获得）'}
          data-testid={`${testId}-start`}
        >
          {props.compact ? '重新连接' : '查看屏幕'}
        </button>
        <button
          type="button"
          onClick={stopViewing}
          disabled={!isLive && active.kind !== 'authorizing'}
          title="关闭即本地释放并通知服务端停止该会话"
          data-testid={`${testId}-stop`}
        >
          关闭查看
        </button>
      </div>}
      {isLive && <details className="mv-diagnostics"><summary>连接详情</summary>
      {evidence != null && (
        <p className="muted" data-testid={`${testId}-evidence`}>
          浏览器观测：包 {evidence.packets} · 字节 {Math.round(evidence.bytes / 1024)}KiB · 解码帧 {evidence.decodedFrames} ·
          呈现帧 {evidence.renderedFrames}{evidence.droppedAUs > 0 ? ` · 积压丢弃 ${evidence.droppedAUs}` : ''}
          {evidence.firstFrameMs != null ? ` · 首帧 ${evidence.firstFrameMs}ms` : ' · 首帧未至'}
        </p>
      )}

      {isLive && (
        <p className="muted" data-testid={`${testId}-session`}>
          会话 {active.mediaSessionId}（短时单用途票；关闭后服务端 ≤2s 清理）。
        </p>
      )}      </details>}

    </div>
  );
}

/** W24R4：Esc 退出放大——独立子组件生命周期绑定，卸载自动移除监听（不碰媒体流） */
function ZoomEscHandler(props: { onExit: () => void }): React.JSX.Element {
  const { onExit } = props;
  useEffect(() => {
    const h = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onExit(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onExit]);
  return <span aria-hidden="true" />;
}
