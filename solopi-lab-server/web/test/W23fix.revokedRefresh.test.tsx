/**
 * W23续修回归：复用非作者审查证据件 C57-independent 的合法夹具版（替代审查指出的
 * 旧 W22 夹具缺口：注册夹具 pending 不携带 clientId、逐条断言只发单个 pending 请求、
 * 同挂载实例刷新而非 cleanup 重挂）。共 2 项——
 * ①注册记录同挂载刷新后 revoked 行隐藏且其余四状态保留、全程只发一个 status=pending 请求；
 * ②同挂载 Client 刷新吊销后卡片/媒体入口消失、筛选计数如实归零。
 * W22.revokedHide.test.tsx 的 11 项账目保持不变，与本文件并存（下轮清账可合并去重，不阻塞本轮）。
 * 口令/票据均 fixture。吊销语义只看 registration.status==='revoked' 权威值——offline/unknown 不混判。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClientStatus } from '../src/pages/ClientStatus';
import { RegistrationRecords } from '../src/pages/RegistrationRecords';
import { CLIENTS_AREA, ENROLLMENTS_AREA } from '../src/api/areas';
import { setProxyRoMode, setRoDevicesAvailable } from '../src/api/connection';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const baseClient = (over: Record<string, unknown>) => ({
  // ClientSummary15 wire形状（RO /ro/clients 原始行）——经 mapClientSummary 映射后入页
  orgId: '01M6GGBGHYYJTD648SY66Q1MM2',
  projectId: '01M6GGBGHYZG3CMXJAJKNT56DE',
  clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
  installationId: U,
  keyFingerprint: 'sha256:' + 'f'.repeat(64),
  status: 'approved',
  grantedAt: '2026-11-04T08:00:00Z',
  clientVersion: '44.7.0',
  capabilities: { media: true, commands: false },
  occupancy: { localUiTasks: 0, cliTasks: 0 },
  online: 'online',
  lastHeartbeatAt: '2026-11-04T09:13:15Z',
  leaseExpiresAt: '2026-11-04T10:13:15Z',
  deviceScope: { deviceId: U, os: 'darwin', hostname: 'U-CC-W21-HOST' },
  ...over,
});
const revokedClient = () => baseClient({
  clientId: '01M6JVA2KF08T0VZ0ZZABRAREVOK',
  status: 'revoked',
  grantedAt: null,
  /* 关键：吊销+在线——吊销判定只能来自 status='revoked'，须从列表隐藏；offline/unknown不混判 */
  online: 'online',
  deviceScope: { deviceId: U, os: 'darwin', hostname: 'revoked-host' },
});
const dev = { deviceId: '01M6DEVICE0000000000000001', deviceName: 'dev', kind: 'phone', status: 'online', lastSeenAt: '2026-11-04T08:00:00Z', lastSnapshotAt: '2026-11-04T08:00:00Z', lastSnapshotId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', discoveredAt: '2026-11-04T08:00:00Z', clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ' };

beforeEach(() => {
  setProxyRoMode(true);
  setRoDevicesAvailable(true);
});

afterEach(() => {
  cleanup();
  setProxyRoMode(false);
  setRoDevicesAvailable(false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});


const enr=(status:string)=>({enrollmentId:'ind-'+status,installationId:'install-'+status,clientId:['pending','rejected'].includes(status)?null:'cid-'+status,status,keyFingerprint:'sha256:'+'a'.repeat(64),clientVersion:'v',scope:{orgId:U,projectId:U},requestedAt:'2026-11-04T08:00:00Z'});
it('C57 same mounted registration refresh hides revoked and preserves four other states',async()=>{
 let rows=['pending','approved','rejected','expired','revoked'].map(enr);const seen:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{seen.push(String(input));return {ok:true,status:200,json:async()=>({items:rows,page:1,pageSize:200,nextPage:null})} as Response;}));
 render(<RegistrationRecords enrollmentsArea={ENROLLMENTS_AREA}/>);
 await waitFor(()=>expect(screen.getByTestId('enrollment-status-ind-approved')).toBeTruthy());
 for(const st of ['pending','approved','rejected','expired'])expect(screen.getByTestId('enrollment-status-ind-'+st)).toBeTruthy();
 expect(screen.queryByTestId('enrollment-status-ind-revoked')).toBeNull();
 expect(seen.length).toBe(1);expect(new URL(seen[0],'https://x').searchParams.get('status')).toBe('pending');
 rows=rows.map(r=>r.status==='approved'?{...r,status:'revoked'}:r);
 fireEvent.click(screen.getByRole('button',{name:'手动刷新'}));
 await waitFor(()=>expect(screen.queryByTestId('enrollment-status-ind-approved')).toBeNull());
 for(const st of ['pending','rejected','expired'])expect(screen.getByTestId('enrollment-status-ind-'+st)).toBeTruthy();
 expect(seen.length).toBe(2);expect(seen.every(u=>new URL(u,'https://x').searchParams.get('status')==='pending')).toBe(true);
});
it('C57 same mounted Client refresh removes card/media and updates filter count',async()=>{
 let rows=[baseClient({}),revokedClient()];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>({ok:true,status:200,json:async()=>({items:String(input).startsWith('/ro/devices')?[dev]:rows,page:1,pageSize:200,nextPage:null})} as Response)));
 render(<ClientStatus clientsArea={CLIENTS_AREA}/>);
 await waitFor(()=>expect(screen.getByTestId('client-card-01M6JVA2KF08T0VZ0ZZABRAQFJ')).toBeTruthy());
 rows=[baseClient({status:'revoked'}),revokedClient()];
 fireEvent.click(screen.getByRole('button',{name:'手动刷新'}));
 await waitFor(()=>expect(screen.queryByTestId('client-card-01M6JVA2KF08T0VZ0ZZABRAQFJ')).toBeNull());
 expect(document.querySelectorAll('[data-testid^="media-viewer-"]').length).toBe(0);
 expect(document.body.textContent).toMatch(/0.*台 Client/);
});
