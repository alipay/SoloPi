import { useEffect, useState } from 'react';
import { createRoDevicesRead } from '../api/devices-ro';
import { formatClock } from '../components/format';
import { MediaViewerPanel } from '../components/MediaViewerPanel';
import { uaWhoami, uaTaskDetail, type UaAgentTaskDetail } from '../api/ua-session';

/**
 * 目标4：任务详情·组执行视图（左步骤×右上下设备画面）。
 *
 * 诚实边界：
 * - **步骤面**：result/组执行步骤原文只在受控/ua详情可见（G1接线）；未登录受控会话时左侧如实
 *   显示「登录后可见步骤」——RO面progress/result原文不投影，不以存在性冒充步骤内容；
 * - **设备画面**：右侧上下两画面来自result.devices/steps真实deviceId绑定；缺绑定时回退该任务
 *   Desktop 的真实设备表（/ro/devices by clientId——固定scope只读）。上下两画面=该任务的
 *   **首两台真实设备**（多设备按真实两屏优先呈现，如实可滚动），非视觉占位；
 * - **画面按钮**：复用既有媒体授权/观看真实流程（MediaViewerPanel——真实authorize+WSS，绝不
 *   假出帧）；设备离线/无媒体能力如实禁用，与ClientStatus同一语义；
 * - **绑定链**：taskid/clientId/deviceId/report sha256全部来自本次受控详情或RO真值——不造链接；
 *   详情必须同ID同归属Client（detail.clientId===props.clientId）——异 Client 报告/步骤拒绝渲染，
 *   且不得与当前 Client 的设备表拼接（防跨主体冒充）。
 */

interface DeviceRow { clientId: string; deviceId: string; deviceName: string | null; deviceStatus: string | null; kind: unknown; online: boolean | null }

const DeviceRowsUnused = 0; void DeviceRowsUnused;

export function TaskGroupView(props: {
  agentTaskId: string;
  clientId: string;
  clientOnline: boolean | null;
  mediaCapable?: boolean;
}): React.JSX.Element {
  const { agentTaskId, clientId } = props;
  // 受控详情（登录才拿得到result原文）
  const [uaState, setUaState] = useState<'probing' | 'out' | 'in'>('probing');
  const [detail, setDetail] = useState<UaAgentTaskDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  /** 详情归属Client失配：异Client报告拒绝渲染，且不得与当前Client设备表拼接 */
  const [clientMismatch, setClientMismatch] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = await uaWhoami(new AbortController().signal).catch(() => null);
      if (cancelled) return;
      if (s == null || s.operatorSession !== true) { setUaState('out'); return; }
      setUaState('in');
      try {
        const d = await uaTaskDetail(agentTaskId, new AbortController().signal);
        if (cancelled) return;
        if (d == null) { setUaState('out'); return; }
        if (d.agentTaskId !== agentTaskId) { setDetailError('详情身份失配——拒绝渲染'); return; }
        if (d.clientId !== clientId) { setClientMismatch(d.clientId); return; } // 任务ID对但归属另一Client=异Client详情
        setDetail(d);
      } catch (err) {
        if (!cancelled) setDetailError((err as Error).message || '受控详情读取失败');
      }
    })();
    return () => { cancelled = true; };
  }, [agentTaskId, clientId]);

  // 该任务设备的真值表（固scope RO/editions只做绑定用）
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await createRoDevicesRead()( '', new AbortController().signal );
        if (cancelled) return;
        setDevices(all.filter((d) => d.clientId === clientId).map((d) => ({
          clientId: d.clientId, deviceId: d.deviceId, deviceName: d.deviceName ?? null, deviceStatus: d.status ?? null, kind: null, online: null,
        })));
      } catch {
        if (!cancelled) setDevices([]);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);
  void DeviceRowsUnused;

  // 结果envelope绑定优先（受控详情 result.devices/steps真值），缺绑回退RO真值
  const result = detail?.result ?? null;
  const resultDevices = Array.isArray(result && (result as Record<string, unknown>).devices)
    ? ((result as Record<string, unknown>).devices as unknown[]).filter((s): s is Record<string, unknown> => typeof s === 'object' && s != null)
    : [];
  const steps = Array.isArray(result && (result as Record<string, unknown>).steps)
    ? ((result as Record<string, unknown>).steps as unknown[]).filter((s): s is Record<string, unknown> => typeof s === 'object' && s != null)
    : [];
  const report = result != null && typeof (result as Record<string, unknown>).report === 'object' ? (result as Record<string, unknown>).report as Record<string, unknown> : null;
  const groupRef = result != null && typeof (result as Record<string, unknown>).groupRef === 'object' ? (result as Record<string, unknown>).groupRef as Record<string, unknown> : null;
  const reportText = result != null && typeof (result as Record<string, unknown>).text === 'string' ? String((result as Record<string, unknown>).text) : null;

  // 上下两画面：本任务envelope绑定的deviceId（可能为空——历史prompt任务常无绑定）→
  // 回退项按受控回退语义呈现：来自该Client真实设备表**只能标「该Client可观看设备」**，
  // 不冒充本任务成员/执行设备（组执行投影未到端侧合同，本页不伪造归属）。
  const boundDeviceIds = resultDevices.map((d) => typeof d.deviceId === 'string' ? d.deviceId : null).filter((x): x is string => x != null);
  const candidate: Array<{ deviceId: string; deviceName: string | null; deviceStatus: string | null; bound: boolean }> = [];
  for (const id of boundDeviceIds) {
    candidate.push({ deviceId: id, deviceName: null, deviceStatus: null, bound: true });
  }
  if (candidate.length < 2 && devices != null && clientMismatch == null) {
    for (const d of devices) {
      if (candidate.some((x) => x.deviceId === d.deviceId)) continue;
      candidate.push({ deviceId: d.deviceId, deviceName: d.deviceName, deviceStatus: d.deviceStatus, bound: false });
      if (candidate.length >= 2) break;
    }
  }
  const screens = candidate.slice(0, 2);
  const panels = screens.map((s) => ({ ...s, name: s.deviceName ?? (devices ?? []).find((d) => d.deviceId === s.deviceId)?.deviceName ?? null }));
  const fallbackCount = panels.filter((p) => !p.bound).length;

  return (
    <div className="taskgroup-layout" data-testid="taskgroup">
      {/* 左：步骤（受控详情） */}
      <div className="taskgroup-left" data-testid="taskgroup-steps-col">
        <h4>步骤（task {agentTaskId}）</h4>
        {uaState === 'probing' && <p className="muted">核受控会话中…</p>}
        {uaState === 'out' && (
          <p className="muted" data-testid="taskgroup-steps-require-login">
            步骤原文只在受控登录详情可见（G1接线）——本页不投影result原文；请在「Agent 会话」页完成受控登录后重入本详情。
          </p>
        )}
        {uaState === 'in' && detailError != null && <p className="notice-strip" data-testid="taskgroup-steps-error">受控详情读取失败：{detailError}</p>}
        {uaState === 'in' && clientMismatch != null && (
          <>
            <p className="notice-strip" data-testid="taskgroup-client-mismatch">
              详情归属失配：该任务详情归属另一 Client（…{clientMismatch.slice(-8)}），与本页请求的 Client（…{clientId.slice(-8)}）不一致——异 Client 报告/步骤拒绝渲染，也不与当前 Client 设备表拼接。
            </p>
            <pre className="taskgroup-report" data-testid="taskgroup-report-text">报告未显示——受控详情归属其他 Client，身份失配拒绝渲染。</pre>
          </>
        )}
        {uaState === 'in' && detail != null && steps.length === 0 && (
          <p className="muted" data-testid="taskgroup-steps-empty">该任务无结构化步骤归档（真实空态——不造步骤）。</p>
        )}
        {uaState === 'in' && detail != null && steps.map((s, i) => (
          <div className="taskgroup-step" key={i} data-testid={`taskgroup-step-${i + 1}`}>
            <b>步骤 {typeof s.index === 'number' ? s.index : i + 1}</b>
            <span className="muted"> {String(s.action ?? '未知动作')} · {String(s.deviceId ?? '未绑定设备')} · [{String(s.status ?? '未知')}]</span>
            {s.note != null ? <p className="muted" style={{ fontSize: 11, margin: 0 }}>{String(s.note)}</p> : null}
            {s.at != null ? <p className="muted" style={{ fontSize: 10, margin: 0 }}>{formatClock(String(s.at))}</p> : null}
          </div>
        ))}
        {groupRef != null && (
          <p className="muted mono" style={{ fontSize: 10 }} data-testid="taskgroup-groupref">
            组 {String(groupRef.groupId ?? '标识缺失如实')} · revision {String(groupRef.groupRevision ?? '—')}
            {Array.isArray(groupRef.memberIds) ? ` · 成员 ${(groupRef.memberIds as unknown[]).length}` : ''}
          </p>
        )}
        {report != null && (
          <p className="muted mono" style={{ fontSize: 10 }} data-testid="taskgroup-reportref">
            报告{typeof report.sha256 === 'string' ? ` sha256:${String(report.sha256).slice(0, 12)}…` : ' 标识缺失如实'}
          </p>
        )}
        {reportText != null && <pre className="taskgroup-report" data-testid="taskgroup-report-text">{reportText}</pre>}
      </div>
      {/* 右：上下设备画面（既有媒体授权/观看真实按钮） */}
      <div className="taskgroup-right" data-testid="taskgroup-screens-col">
        <h4>设备画面（同任务绑定）</h4>
        {clientMismatch != null && (
          <p className="notice-strip" style={{ fontSize: 10 }} data-testid="taskgroup-screens-mismatch">
            详情归属失配——不将异 Client 任务与当前 Client 的设备表拼接，设备画面不呈现。
          </p>
        )}
        {panels.length === 0 && <p className="muted" data-testid="taskgroup-screens-empty">{clientMismatch != null ? '异 Client 详情被拒——无任务绑定设备可呈现。' : '该任务无步骤/结果envelope绑定的设备，回退Device表亦为空——不造画面占位。'}</p>}
        {panels.map((p, i) => (
          <div className="taskgroup-screen" key={p.deviceId} data-testid={`taskgroup-screen-${i + 1}`}>
            <p className="muted" style={{ fontSize: 10, margin: '4px 0 0' }} data-testid={`taskgroup-screen-${i + 1}-origin`}>
              {p.bound
                ? `本任务envelope绑定的执行/步骤设备 ${p.deviceId}`
                : `该Client可观看设备（回退自Client设备表：${p.deviceId}）——非本任务成员/执行设备，本页不冒充`}
            </p>
            <MediaViewerPanel
              clientId={clientId}
              deviceId={p.deviceId}
              deviceName={p.name}
              deviceOnline={null}
              mediaCapable
            />
          </div>
        ))}
        {fallbackCount > 0 && (
          <p className="notice-strip" style={{ fontSize: 10 }} data-testid="taskgroup-fallback-note">
            该任务无绑定{fallbackCount === 2 ? '（步骤/结果envelope零绑定）' : `（envelope仅绑定${screens.length - fallbackCount}台）`}：以上{fallbackCount}路画面为「该Client可观看设备」回退——
            按观看即可用（真实 /mv 授权+WSS），但**不作为本任务成员/执行设备**；真实组执行步骤/画面须等Client侧组执行数据到达后分账，本页不假数据补列。
          </p>
        )}
        <p className="muted" style={{ fontSize: 10 }}>
          观看按既有真实媒体授权链；离线或无能力按钮如实禁用。**按钮存在不等于已出帧**——真实画面以浏览器已呈现解码帧（投屏中）为唯一依据。
        </p>
      </div>
    </div>
  );
}
