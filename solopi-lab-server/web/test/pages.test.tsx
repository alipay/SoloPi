/**
 * 分版本测试账目：W14 pages审批3项→注册记录2项，124→123；
 * W15 RO投影+1→124；W16确认空集+1与稳定性7→132；
 * W17+4→136；W18+2→138。后续新增页面反例单独计数。
 * scope/card分组只证明本地展示，不证明服务端跨scope授权。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_AREA, CLIENTS_AREA, ENROLLMENTS_AREA } from '../src/api/areas';
import { RegistrationRecords } from '../src/pages/RegistrationRecords';
import { ClientStatus, ClientCards } from '../src/pages/ClientStatus';
import { RegistrationGuide } from '../src/pages/RegistrationGuide';
import { fxClients, fxEnrollments, wiredTestArea } from './fixtures';

describe('注册记录页（RegistrationRecords，默认未接线）', () => {
  it('显示未接入（真实数据区未接线语义保持）', () => {
    render(<RegistrationRecords enrollmentsArea={ENROLLMENTS_AREA} />);
    expect(screen.getByText(/尚未接入/)).toBeTruthy();
  });

  it('接线真实数据后渲染记录行且零审批按钮（用户决定：注册即成功）', async () => {
    const wiredArea = wiredTestArea(() => Promise.resolve(fxEnrollments));
    render(<RegistrationRecords enrollmentsArea={wiredArea} />);
    expect(await screen.findByText('enr-0001')).toBeTruthy();
    const approveButtons = screen
      .getAllByRole('button')
      .filter((b) => ['批准', '批准所选', '拒绝', '拒绝所选'].includes(b.textContent ?? ''));
    expect(approveButtons.length).toBe(0);
  });
});

describe('Client 页与卡片（ClientCards）', () => {
  it('默认未接线：显示未接入', () => {
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    expect(screen.getByText(/尚未接入/)).toBeTruthy();
  });

  it('每台Client独立成卡，不混合设备/字段', () => {
    render(<ClientCards rows={fxClients} />);
    expect(document.querySelectorAll('[data-testid^="client-card-"]').length).toBe(fxClients.length);
    const cardA = document.querySelector('[data-testid="client-card-dev-orgA-0001"]');
    expect(cardA?.textContent ?? '').not.toContain('dev-orgB-0001');
  });

  it('显式渲染注册状态、心跳相对时间与能力标签', () => {
    render(<ClientCards rows={fxClients} />);
    expect(screen.getByText('待审批')).toBeTruthy();
    expect(screen.getAllByText('已批准').length).toBe(2);
    expect(screen.getByText('从未心跳')).toBeTruthy();
    expect(screen.getAllByText(/分钟前|小时前|天前|刚刚/).length).toBeGreaterThan(0);
    expect(screen.getByText(/媒体（未声明）/)).toBeTruthy();
  });

  it('Online 徽标只按权威 presence 字段显示：在线1例、离线1例、未提供显示未知', () => {
    render(<ClientCards rows={fxClients} />);
    expect(document.querySelectorAll('.badge-online').length).toBe(1);
    expect(document.querySelectorAll('.badge-offline').length).toBe(1);
    // 未提供 online 字段的Client显示未知，即使有注册信息
    expect(document.querySelectorAll('.badge-unknown').length).toBe(1);
  });

  it('唯一身份以clientId独立成卡（结构化键回归）', () => {
    render(
      <ClientCards
        rows={fxClients.concat([
          {
            ...(fxClients[0] as typeof fxClients[number]),
            clientId: 'dev-slash-0001',
            displayName: '唯一身份行',
            scope: { org: 'orgA/x', project: 'paybox' },
          },
        ])}
      />,
    );
    const slashed = document.querySelector('[data-testid="client-card-dev-slash-0001"]');
    expect(slashed?.textContent ?? '').toContain('唯一身份行');
    const plain = document.querySelector('[data-testid="client-card-dev-orgA-0001"]');
    expect(plain?.textContent ?? '').not.toContain('唯一身份行');
  });
});

describe('注册引导页', () => {
  it('显示流程与未接入说明，不渲染模板命令或示例值', () => {
    render(<RegistrationGuide bootstrapArea={BOOTSTRAP_AREA} />);
    expect(screen.getByRole('button',{name:'上传安装包'})).toBeTruthy();
    expect(screen.getByText('如何接入实验室')).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/solopi enroll|REGISTER_TOKEN|https?:\/\/example/);
    expect(text).toMatch(/一次性令牌/);
  });
});
