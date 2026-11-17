import { useSyncExternalStore } from 'react';
import { getConnectionView, subscribeConnection } from '../api/connection';

/** 只根据 Server 实际读取失败显示连接提示。 */
export function OnlineBanner(): React.JSX.Element {
  const view = useSyncExternalStore(subscribeConnection, getConnectionView);
  if (view.health !== 'unreachable') return <></>;
  return <div className="banner banner-offline" role="status">暂时无法读取实验室数据，正在自动重试。</div>;
}
