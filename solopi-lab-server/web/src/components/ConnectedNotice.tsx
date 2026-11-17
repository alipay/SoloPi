import { useSyncExternalStore } from 'react';
import { getRuntimeConnection, subscribeConnection } from '../api/connection';

/**
 * 连接状态横幅（W6）：有连接时显示已连接只读事实与服务端计数语义；
 * 需如实声明——web-viewer令牌按合同仅按scope控制，API面写端点仍开放，
 * 本页写操作保持禁用（不以令牌名义称“只读token”）。
 */
export function ConnectedNotice(): React.JSX.Element {
  const conn = useSyncExternalStore(subscribeConnection, getRuntimeConnection);
  if (conn == null) return <></>;
  return (
    <div className="banner banner-connected" role="status" data-testid="connected-notice">
      ✅ 已连接（只读列表）：{conn.apiBaseUrl} · 作用域 {conn.orgKey ?? conn.scope.orgId} /{' '}
      {conn.projectKey ?? conn.scope.projectId}
      <span className="muted">
        （令牌按合同为scope级授权，API面写端点仍开放——本页写操作保持禁用；授权失效或断开时列表将显示未知与原因，不以未知回退为0。）
      </span>
    </div>
  );
}
