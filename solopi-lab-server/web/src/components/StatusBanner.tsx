import { useSyncExternalStore } from 'react';
import { getConnectionView, subscribeConnection } from '../api/connection';
import { UnconnectedNotice } from './UnconnectedNotice';
import { ConnectedNotice } from './ConnectedNotice';

/**
 * 顶部状态横幅（W7/W8）：
 * - 无连接 → 未连接（数量未知）；
 * - 有连接 + untested → **待验证**（数量未知，不显示“已连接”，W8/C13④）；
 * - 有连接 + ok → 绿色已连接（仅由真实读取成功驱动）；
 * - 有连接 + denied（真实401/403）→ 授权失效（不显示“已连接”）。
 */
export function StatusBanner(): React.JSX.Element {
  const view = useSyncExternalStore(subscribeConnection, getConnectionView);
  if (view.health === 'unreachable') return <></>; // 由连接失败横幅显示，避免仍声称已连接
  // W11：固定scope只读代理模式（同源 /ro/*，无token，服务端固定 solopi-lab/glasses）
  if (view.proxyRo) {
    if (view.health === 'denied') {
      return (
        <div className="banner banner-denied" role="status" data-testid="ro-denied-notice">
          ⛔ 只读代理读取被服务端拒绝——<strong>注册电脑数量：未知</strong>，原因见各数据区错误卡片。
        </div>
      );
    }
    if (view.health === 'ok') {
      return (
        <div className="banner banner-connected" role="status" data-testid="ro-connected-notice">
          ● 实验室已连接
        </div>
      );
    }
    return (
      <div className="banner banner-waiting" role="status" data-testid="ro-waiting-notice">
        正在连接实验室——<strong>已注册电脑数量：未知</strong>。
      </div>
    );
  }
  if (view.connection == null) return <UnconnectedNotice />;
  if (view.health === 'untested') {
    return (
      <div className="banner banner-waiting" role="status" data-testid="waiting-notice">
        ⏳ 连接配置已保存（**待验证**）：尚未完成一次真实读取——
        <strong>已注册电脑数量：未知</strong>。首次读取成功后才会显示“已连接”；若服务端拒绝（401/403）将转为授权失效状态。
      </div>
    );
  }
  if (view.health === 'denied') {
    return (
      <div className="banner banner-denied" role="status" data-testid="denied-notice">
        ⛔ 连接配置仍在，但服务端拒绝访问（401/403：token无效、吊销、过期或跨作用域）——
        <strong>当前读取未生效，注册电脑数量：未知</strong>；原因与最后成功时间见各数据区错误卡片。
        可重新粘贴受控交付的新 token（连接设置）恢复读取。
      </div>
    );
  }
  return <ConnectedNotice />;
}
