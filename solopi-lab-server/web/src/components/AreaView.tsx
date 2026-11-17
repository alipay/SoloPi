import type { ReactNode } from 'react';
import type { DataArea } from '../api/areas';
import { usePollingArea } from '../hooks/usePollingArea';
import { formatClock } from './format';

/**
 * 数据区视图：未接入 / 加载中 / 失败(可重试) / 空数据 / 正常数据
 * 各状态显式渲染，覆盖 loading/空/失败/离线/最后更新时间。
 */
export function AreaView<T>(props: {
  area: DataArea<T>;
  /** 有数据时的整表渲染（支持分组） */
  renderRows: (rows: T[]) => ReactNode;
  emptyHint?: string;
}): React.JSX.Element {
  const { area, renderRows, emptyHint } = props;
  const poll = usePollingArea(area);

  if (!area.wired) {
    return (
      <section className="card card-notwired" aria-label={`${area.title}未接入`}>
        <h3>「{area.title}」尚未接入</h3>
        <p>以下接口等待服务端共享合同定稿后接线，当前不发起请求、不显示样本数据：</p>
        <ul>
          {area.pendingReason.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <table className="mini-table">
          <thead>
            <tr>
              <th>接口（草案）</th>
              <th>用途</th>
              <th>写操作</th>
            </tr>
          </thead>
          <tbody>
            {area.draftEndpoints.map((ep) => (
              <tr key={`${ep.method}-${ep.purpose}`}>
                <td>{ep.path}</td>
                <td>{ep.purpose}</td>
                <td>{ep.write ? '是 · 保持不可提交' : '否'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  if (poll.offline || poll.status === 'offline') {
    return (
      <section className="card card-offline" aria-label={`${area.title}离线`}>
        <h3>「{area.title}」当前离线</h3>
        <p>网络连接已断开，读取暂停。恢复在线后会自动继续轮询。</p>
        {poll.lastUpdatedAt != null && (
          <p className="muted">最后成功更新：{formatClock(poll.lastUpdatedAt)}</p>
        )}
      </section>
    );
  }

  if (poll.status === 'loading') {
    return (
      <section className="card" aria-label={`${area.title}加载中`}>
        <p>正在读取「{area.title}」…</p>
      </section>
    );
  }

  if (poll.status === 'error') {
    return (
      <section className="card card-error" aria-label={`${area.title}读取失败`}>
        <h3>「{area.title}」读取失败</h3>
        <p>{poll.error ?? '未知错误'}</p>
        {poll.lastUpdatedAt != null && (
          <p className="muted">最后成功更新：{formatClock(poll.lastUpdatedAt)}（当前数据已陈旧）</p>
        )}
        <button type="button" onClick={() => poll.refresh()} disabled={poll.refreshing}>
          {poll.refreshing ? '正在重试…' : '重试'}
        </button>
      </section>
    );
  }

  const updatedAt = poll.lastUpdatedAt != null ? formatClock(poll.lastUpdatedAt) : '—';
  const refreshMeta = (
    <p className="muted" data-testid="last-updated">
      最后更新时间：{updatedAt}
      {poll.refreshing ? ' · 正在刷新…' : ''}
    </p>
  );

  if (poll.status === 'empty') {
    return (
      <section className="card" aria-label={`${area.title}为空`}>
        <p>「{area.title}」暂无数据。</p>
        <p className="muted">{emptyHint ?? '当前范围内没有条目。'}</p>
        {refreshMeta}
      </section>
    );
  }

  return (
    <section aria-label={area.title}>
      <div className="row-head">
        <h3>{area.title}</h3>
        <button type="button" onClick={() => poll.refresh()} disabled={poll.refreshing}>
          {poll.refreshing ? '刷新中…' : '手动刷新'}
        </button>
      </div>
      {refreshMeta}
      {renderRows(poll.rows)}
    </section>
  );
}
