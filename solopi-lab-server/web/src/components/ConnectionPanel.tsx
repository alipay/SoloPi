import { useState } from 'react';
import {
  clearRuntimeConnection,
  describeRuntimeConnection,
  setRuntimeConnection,
  type ConnectionSnapshot,
} from '../api/connection';

/**
 * 连接设置面板（真实API配置入口，W4）。
 *
 * - 输入的 API基址/管理token/orgId/projectId 只保存于内存在连接配置；
 *   **不写localStorage、不进URL、不进日志**，刷新即清空。
 * - token 输入框为 password 且保存后**永不回显**，只显示“已配置”状态。
 * - 即便已配置，三数据区仍保持未接线：真实读取启用需服务端候选通过
 *   独立复核、部署地址就绪与受控授权交付，本面板不触发任何请求。
 */
export function ConnectionPanel(props: { onClose: () => void }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(() => describeRuntimeConnection());
  const [apiBaseUrl, setApiBaseUrl] = useState(snapshot.apiBaseUrl ?? '');
  const [orgId, setOrgId] = useState(snapshot.scope?.orgId ?? '');
  const [projectId, setProjectId] = useState(snapshot.scope?.projectId ?? '');
  const [orgKey, setOrgKey] = useState(snapshot.orgKey ?? '');
  const [projectKey, setProjectKey] = useState(snapshot.projectKey ?? '');
  const [token, setToken] = useState(''); // 永不回显：每次打开都是空输入
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = () => {
    const err = setRuntimeConnection({
      apiBaseUrl: apiBaseUrl.trim(),
      adminToken: token,
      scope: { orgId: orgId.trim(), projectId: projectId.trim() },
      orgKey: orgKey.trim() || undefined,
      projectKey: projectKey.trim() || undefined,
    });
    if (err != null) {
      setError(err);
      setSaved(false);
      return;
    }
    setError(null);
    setSaved(true);
    setToken(''); // 保存后立即清除输入框中的token明文
    setSnapshot(describeRuntimeConnection());
  };

  const clear = () => {
    // W8/C13②：显式断开=清除连接与**全部**身份/base/token输入（表单不留残留值）
    clearRuntimeConnection();
    setApiBaseUrl('');
    setOrgId('');
    setProjectId('');
    setOrgKey('');
    setProjectKey('');
    setToken('');
    setSnapshot(describeRuntimeConnection());
    setSaved(false);
    setError(null);
  };

  return (
    <section className="card card-connection" aria-label="连接设置">
      <h3>连接设置（真实API入口 · 未启用读取）</h3>
      <p className="muted">
        管理token仅保存于本页内存，刷新即清空；不写入URL、日志或构建产物。
        远程基址必须为受控 HTTPS（远程管理 Bearer 不得发往明文 HTTP）；本机隔离开发例外仅限 127.0.0.1/localhost。
        配置保存不发起任何请求——数据区保持未接线，启用需服务端候选通过独立复核、部署就绪与受控授权交付。
      </p>

      <label className="field">
        <span>API 基址（含 http(s):// 与端口）</span>
        <input
          type="text"
          value={apiBaseUrl}
          onChange={(e) => setApiBaseUrl(e.target.value)}
          placeholder="https://lab-server.example:port"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>管理 token（来自受控 <code>admin grant</code> 一次性交付）</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="保存后不再显示"
          autoComplete="off"
        />
      </label>
      <label className="field">
        <span>orgId（ULID，来自授权映射）</span>
        <input type="text" value={orgId} onChange={(e) => setOrgId(e.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span>projectId（ULID，来自授权映射）</span>
        <input type="text" value={projectId} onChange={(e) => setProjectId(e.target.value)} autoComplete="off" />
      </label>
      <div className="field-row">
        <label className="field">
          <span>orgKey（展示标签，可选）</span>
          <input type="text" value={orgKey} onChange={(e) => setOrgKey(e.target.value)} autoComplete="off" />
        </label>
        <label className="field">
          <span>projectKey（展示标签，可选）</span>
          <input type="text" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} autoComplete="off" />
        </label>
      </div>

      {error != null && <p className="form-error" role="alert">{error}</p>}
      {saved && <p className="form-ok">已保存到本页内存（未启用真实读取）。</p>}

      <p className="muted" data-testid="connection-state">
        {snapshot.configured
          ? `已配置：${snapshot.apiBaseUrl ?? ''} · scope ${snapshot.scope?.orgId}/${snapshot.scope?.projectId}`
          : '未配置连接。'}
      </p>

      <div className="writes-bar">
        <button type="button" onClick={save}>保存（仅内存）</button>
        <button type="button" onClick={clear}>清除配置</button>
        <button type="button" onClick={props.onClose}>关闭</button>
      </div>
    </section>
  );
}
