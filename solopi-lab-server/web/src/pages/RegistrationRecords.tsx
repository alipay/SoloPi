import type { DataArea } from '../api/areas';
import { createEnrollmentsRead } from '../api/fetchers-v015';
import { createRoEnrollmentsRead } from '../api/readonly-proxy';
import { useDeliveryArea } from '../hooks/useDeliveryArea';
import type { RuntimeConnection } from '../api/connection';
import { AreaView } from '../components/AreaView';
import { formatClock } from '../components/format';
import type { EnrollmentRequest } from '../api/types';

/** 注册记录行（真实数据only；已吊销不在本页展示——W22.1 用户决定含注册记录） */
function RecordRow(props: { item: EnrollmentRequest }): React.JSX.Element {
  const { item } = props;
  return (
    <tr>
      <td className="mono">{item.enrollmentId}</td>
      <td className="mono">{item.installationId}</td>
      <td className="mono">{item.publicKeyFingerprint}</td>
      <td>
        {item.scope.org} / {item.scope.project}
      </td>
      <td>{item.clientVersion}</td>
      <td>{formatClock(item.createdAt)}</td>
      <td data-testid={`enrollment-status-${item.enrollmentId}`}>
        {item.status === 'approved' ? (
          <span className="badge badge-approved">已注册</span>
        ) : item.status === 'pending' ? (
          <span className="badge">待处理</span>
        ) : item.status === 'rejected' ? (
          <span className="badge">已拒绝</span>
        ) : item.status === 'expired' ? (
          <span className="badge">已过期</span>
        ) : (
          <span className="badge badge-approved">已注册</span>
        )}
        <span className="muted" style={{ marginLeft: 6 }}>（页面只读）</span>
      </td>
    </tr>
  );
}

/**
 * 注册记录页（W14 改版）：
 * 按用户最新决定（"server不需要审批，client注册过来就成功"），
 * 本页只读展示注册记录；不再提供任何审批写入口。
 */
export function RegistrationRecords(props: {
  enrollmentsArea: DataArea<EnrollmentRequest>;
}): React.JSX.Element {
  const enrollmentsArea = useDeliveryArea(
    props.enrollmentsArea,
    () => createRoEnrollmentsRead(),
    (conn: RuntimeConnection) => createEnrollmentsRead(conn),
  );
  return (
    <section className="zone" aria-label="注册记录">
      <div className="zone-title-row">
        <h3 style={{ margin: 0 }}>注册记录</h3>
        <p className="muted" style={{ margin: 0 }}>
          页面只读。当前部署策略：Client 注册即成功；已吊销记录不在本页展示（服务端历史保留）。
        </p>
      </div>
      <AreaView<EnrollmentRequest>
        area={enrollmentsArea}
        emptyHint="服务端确认空集：当前没有注册记录。"
        renderRows={(rows) => (
          <table className="mini-table">
            <thead>
              <tr>
                <th>记录标识</th>
                <th>安装身份</th>
                <th>公钥指纹</th>
                <th>作用域</th>
                <th>客户端版本</th>
                <th>注册时间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody data-testid="enrollment-rows">
              {/* W22.1（用户决定含注册记录）：已吊销记录前端隐藏——只看权威 status==='revoked'；
                  pending/待处理、rejected、expired 等非吊销状态如实展示不误伤 */}
              {rows.filter((item) => item.status !== 'revoked').map((item) => (
                <RecordRow key={item.enrollmentId} item={item} />
              ))}
            </tbody>
          </table>
        )}
      />
    </section>
  );
}
