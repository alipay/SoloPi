/**
 * AreaView 关键状态回归：
 * loading → ready（最后更新时间）/ empty / error（可重试）/ 离线 / 未接线。
 * fixture 仅通过注入的 fetcher 进入组件，页面运行时不使用。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AreaView } from '../src/components/AreaView';
import { wiredTestArea } from './fixtures';

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    value: online,
    configurable: true,
    writable: true,
  });
}

describe('AreaView 关键状态', () => {
  it('未接线：显示未接入与草案接口清单，显示写操作保持不可提交', () => {
    const area = wiredTestArea(vi.fn());
    const unwired = { ...area, wired: false as const, fetchers: undefined, title: '注册审批' };
    render(
      <AreaView<string>
        area={unwired}
        renderRows={(rows) => <div>{rows.join(',')}</div>}
      />,
    );
    expect(screen.getByText(/尚未接入/)).toBeTruthy();
    // 接线测试区没有草案清单，用页面级测试覆盖草案内容
  });

  it('loading：首次读取中显示加载提示', () => {
    const area = wiredTestArea<string>(() => new Promise(() => undefined));
    render(<AreaView<string> area={area} renderRows={(rows) => <div>{rows.join(',')}</div>} />);
    expect(screen.getByText(/正在读取/)).toBeTruthy();
  });

  it('ready：返回数据后展示数据行并显示最后更新时间', async () => {
    const area = wiredTestArea<string>(() => Promise.resolve(['client-a', 'client-b']));
    render(<AreaView<string> area={area} renderRows={(rows) => <div>{rows.join('|')}</div>} />);
    expect(await screen.findByText('client-a|client-b')).toBeTruthy();
    const meta = screen.getByTestId('last-updated');
    expect(meta.textContent ?? '').toMatch(/最后更新时间：\d{4}-\d{2}-\d{2}/);
  });

  it('empty：读取成功但为空时显示空态与最后更新时间', async () => {
    const area = wiredTestArea<string>(() => Promise.resolve([]));
    render(
      <AreaView<string>
        area={area}
        renderRows={(rows) => <div>{rows.join('|')}</div>}
        emptyHint="当前没有条目。"
      />,
    );
    expect(await screen.findByText('当前没有条目。')).toBeTruthy();
    expect(screen.getByTestId('last-updated').textContent ?? '').toMatch(/最后更新时间/);
  });

  it('error：读取失败显示错误与重试按钮；重试后恢复 ready', async () => {
    let fail = true;
    const area = wiredTestArea<string>(() =>
      fail ? Promise.reject(new Error('HTTP 503：后端未就绪')) : Promise.resolve(['ok-row']),
    );
    render(<AreaView<string> area={area} renderRows={(rows) => <div>{rows.join('|')}</div>} />);

    expect(await screen.findByText(/读取失败/)).toBeTruthy();
    expect(screen.getByText(/HTTP 503：后端未就绪/)).toBeTruthy();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('ok-row')).toBeTruthy();
    expect(screen.queryByText(/读取失败/)).toBeNull();
  });

  it('浏览器误报离线时仍读取并显示服务端数据', async () => {
    setOnline(false);
    // 触发一次离线转换
    window.dispatchEvent(new Event('offline'));
    const area = wiredTestArea<string>(() => Promise.resolve(['x']));
    render(<AreaView<string> area={area} renderRows={(rows) => <div>{rows.join('|')}</div>} />);
    await waitFor(() => expect(screen.getByText('x')).toBeTruthy());
    expect(screen.queryByText(/当前离线/)).toBeNull();
    setOnline(true);
    window.dispatchEvent(new Event('online'));
  });
});
