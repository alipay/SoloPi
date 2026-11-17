import type { ClientPresence, ClientRegStatus } from '../api/types';

const LABEL: Record<ClientRegStatus, string> = {
  pending: '待审批',
  approved: '已批准',
  revoked: '已吊销',
  expired: '已过期',
  rejected: '已拒绝',
};

/** 注册状态徽标 */
export function StateBadge(props: { status: ClientRegStatus }): React.JSX.Element {
  return <span className={`badge badge-${props.status}`}>{LABEL[props.status]}</span>;
}

/**
 * 在线性徽标：仅消费服务端权威 presence 字段（合同 §2.3）。
 * 字段未提供时显示「未知」，不凭心跳/租约推导。
 */
export function OnlineBadge(props: { presence: ClientPresence }): React.JSX.Element {
  const label =
    props.presence === 'online' ? '在线' : props.presence === 'offline' ? '离线' : '未知';
  return <span className={`badge badge-${props.presence}`}>{label}</span>;
}

/** 能力声明标签：按申报值渲染，缺项显示未声明 */
export function CapabilityTags(props: {
  capabilities: { media: boolean; command: boolean };
}): React.JSX.Element {
  return (
    <span className="tags">
      <span className={`tag ${props.capabilities.media ? '' : 'dim'}`}>
        媒体{props.capabilities.media ? '' : '（未声明）'}
      </span>
      <span className={`tag ${props.capabilities.command ? '' : 'dim'}`}>
        命令{props.capabilities.command ? '' : '（未声明）'}
      </span>
    </span>
  );
}
