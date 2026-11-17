/**
 * 全局未连接横幅（W5/W6）：在数据区接线放行/连接建立前，
 * 显著标注当前未连接、无法读取真实注册状态、注册数量未知。
 */
export function UnconnectedNotice(): React.JSX.Element {
  return (
    <div className="banner banner-unconnected" role="status" data-testid="unconnected-notice">
      ⛔ 当前状态：未连接 lab-server —— 本页不能读取任何真实注册电脑 / 待审批 / 在线状态数据，
      <strong>已注册电脑数量：未知</strong>。下方各数据区均显示「尚未接入」。
      请经「连接设置」录入受控交付的 API 基址与授权映射（token 仅本页内存），
      或使用本机开发实例的受控引导注入；启用只读真实读取需服务端候选通过独立复核并部署。
    </div>
  );
}
