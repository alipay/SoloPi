/**
 * W23续修回归（复用非作者审查证据件，C64.integration 全文）：
 * 4 项真实 fetch/polling hooks 反例——不做任何 hook mock：
 * ①Client 请求悬置时设备快照不得推 0；②设备读取悬置时工作台不得报 0/0 真零；
 * ③点击刷新必须对 Client 与设备两资源都真实发请求；④轮询 10s 网络失败后保留旧行并显式标注读取失败。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workspace } from '../src/pages/Workspace';
import { Overview } from '../src/pages/Overview';
import { CLIENTS_AREA } from '../src/api/areas';
import { setProxyRoMode, setRoDevicesAvailable } from '../src/api/connection';
const CID='01M6JVA2KF08T0VZ0ZZABRAQFJ',U='01ARZ3NDEKTSV4RRFFQ69G5FAV';
const client={orgId:U,projectId:U,clientId:CID,installationId:U,keyFingerprint:'sha256:'+'a'.repeat(64),status:'approved',grantedAt:'2026-11-04T08:00:00Z',clientVersion:'44.7.0',capabilities:{media:true,commands:false},occupancy:{localUiTasks:0,cliTasks:0},online:'online',lastHeartbeatAt:'2026-11-04T09:13:15Z',leaseExpiresAt:'2026-11-04T10:13:15Z',deviceScope:{deviceId:U,os:'darwin',hostname:'fixture-client'}};
const dev={orgId:U,projectId:U,clientId:CID,deviceId:U,deviceName:'fixture-phone',kind:'phone',status:'online',lastSeenAt:'2026-11-04T08:00:00Z',lastSnapshotAt:'2026-11-04T08:00:00Z',lastSnapshotId:U,discoveredAt:'2026-11-04T08:00:00Z'};
const json=(items:unknown[])=>({ok:true,status:200,json:async()=>({items,page:1,pageSize:200,nextPage:null})}) as Response;
beforeEach(()=>{setProxyRoMode(true);setRoDevicesAvailable(true)});
afterEach(()=>{cleanup();setProxyRoMode(false);setRoDevicesAvailable(false);vi.unstubAllGlobals();vi.useRealTimers()});
it('actual fetch hooks: confirmed device read cannot imply zero while client read pending',async()=>{vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const u=String(input);if(u.startsWith('/ro/clients'))return new Promise<Response>(()=>{});return json(u.startsWith('/ro/devices')?[dev]:[])}));render(<Overview/>);await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('正在读取实验室电脑'));expect(screen.getByLabelText('实验室工作摘要').textContent).toContain('—')});
it('actual fetch hooks: workspace pending read cannot report numeric zero denominator',async()=>{vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>String(input).startsWith('/ro/devices')?new Promise<Response>(()=>{}):json([client])));render(<Workspace clientsArea={CLIENTS_AREA}/>);await waitFor(()=>expect(screen.getByTestId('workspace-devices-unknown')).toBeTruthy());expect(screen.getByTestId('workspace-device-count').textContent).not.toContain('0 / 0')});
it('actual fetch hooks: clicking refresh must request both resources',async()=>{let c=0,d=0;vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{if(String(input).startsWith('/ro/devices')){d++;return json([dev])}c++;return json([client])}));render(<Workspace clientsArea={CLIENTS_AREA}/>);await waitFor(()=>expect(screen.getByTestId('workspace-device-'+U)).toBeTruthy());const oldD=d,oldC=c;fireEvent.click(screen.getByText('↻ 刷新状态'));await waitFor(()=>expect(c).toBeGreaterThan(oldC));expect(d).toBeGreaterThan(oldD)});
it('actual polling hooks: network failure preserves row with visible stale warning',async()=>{vi.useFakeTimers();let fail=false;vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{if(String(input).startsWith('/ro/devices')){if(fail)throw Error('DEVICE_READ_FAILED');return json([dev])}return json([client])}));render(<Workspace clientsArea={CLIENTS_AREA}/>);await act(async()=>{for(let i=0;i<25;i++)await Promise.resolve()});expect(screen.getByTestId('workspace-device-'+U)).toBeTruthy();fail=true;await act(async()=>{vi.advanceTimersByTime(10000);for(let i=0;i<25;i++)await Promise.resolve()});expect(screen.getByTestId('workspace-device-'+U)).toBeTruthy();expect(document.body.textContent).toMatch(/读取失败|数据陈旧/)});
