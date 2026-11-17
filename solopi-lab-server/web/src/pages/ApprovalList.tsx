import type { DataArea } from '../api/areas';
import { createEnrollmentsRead } from '../api/fetchers-v015';
import { createRoEnrollmentsRead } from '../api/readonly-proxy';
import { useDeliveryArea } from '../hooks/useDeliveryArea';
import type { RuntimeConnection } from '../api/connection';
import { AreaView } from '../components/AreaView';
import { formatClock } from '../components/format';
import type { EnrollmentRequest } from '../api/types';

/** 审批行（仅在已接线且有真实数据时渲染） */
function EnrollmentRow(props: { item: EnrollmentRequest }): React.JSX.Element {
  const { item } = props;
  return (
    <tr>
      <td>{item.enrollmentId}</td>
      <td>{item.installationId}</td>
      <td className="mono">{item.publicKeyFingerprint}</td>
      <td>
        {item.scope.org} / {item.scope.project}
      </td>
      <td>{item.clientVersion}</td>
      <td>{formatClock(item.createdAt)}</td>
      <td>
        <button type="button" disabled title="等待服务端合同确认，写操作保持不可提交">
          批准
        </button>
        <button type="button" disabled title="等待服务端合同确认，写操作保持不可提交">
          拒绝
        </button>
      </td>
    </tr>
  );
}

/**
 * 审批列表页。
 * 写操作（批准/拒绝/吊销）在服务端合同确认前一律禁用，不产生任何提交。
 */
export function ApprovalList(props: {
  enrollmentsArea: DataArea<EnrollmentRequest>;
}): React.JSX.Element {
  // W6接线：有受控连接时启用真实只读读取；无连接保持未接入
  const enrollmentsArea = useDeliveryArea(
    props.enrollmentsArea,
    () => createRoEnrollmentsRead(),
    (conn: RuntimeConnection) => createEnrollmentsRead(conn),
  );
  return (
    <div>
      <h2>注册审批</h2>
      <p className="muted">
        审批动作是状态变更写操作。本页保持只读，按钮禁用不提交（令牌为scope级授权，不以“只读token”名义称已受限）。
      </p>

      {/* 写操作显式禁用（Web不提供任何状态变更入口） */}
      <div className="writes-bar" aria-label="审批写操作不可用">
        <button type="button" disabled title="本页只读：写操作保持禁用，不进行任何提交">
          批准所选
        </button>
        <button type="button" disabled title="本页只读：写操作保持禁用，不进行任何提交">
          拒绝所选
        </button>
        <span className="muted">写操作禁用 · 网页不提供状态变更入口（合同管理操作权限位为服务端留项）</span>
      </div>

      <AreaView<EnrollmentRequest>
        area={enrollmentsArea}
        emptyHint="服务端确认空集：当前没有待审批的注册申请（0 条）。"
        renderRows={(rows) => (
          <table className="mini-table">
            <thead>
              <tr>
                <th>申请标识</th>
                <th>安装身份</th>
                <th>公钥指纹</th>
                <th>申请作用域</th>
                <th>客户端版本</th>
                <th>申请时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <EnrollmentRow key={item.enrollmentId} item={item} />
              ))}
            </tbody>
          </table>
        )}
      />
    </div>
  );
}
