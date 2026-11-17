import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {DeviceGroupsPanel} from '../src/components/DeviceGroupsPanel';
const api=vi.hoisted(()=>({lab:vi.fn()}));vi.mock('../src/api/lab',()=>({lab:api.lab}));
const catalog=()=>({clientId:'client-a',hostname:'Lab A',devices:[{deviceId:'phone-a',name:'Phone A',serial:'phone-sn',kind:'phone'},{deviceId:'glass-a',name:'Glasses A',serial:'glass-sn',kind:'glasses'}],groups:[{groupId:'group-a',revision:7,name:'Official group',alias:'Desk A',code:'desk-a',enabled:true,members:[{deviceId:'phone-a',role:'phone'},{deviceId:'glass-a',role:'glasses'}]}],cases:[],updatedAt:1});
afterEach(cleanup);beforeEach(()=>{localStorage.clear();api.lab.mockReset();api.lab.mockImplementation(async(path:string)=>path==='catalog'?{items:[catalog()]}:path==='commands'?{}:{status:'succeeded',result:{success:true,group:{...catalog().groups[0],revision:8,alias:'Desk B',enabled:false}}});});
describe('device group configuration',()=>{
 it('reload restores an uncertain save and queries the original request without POST',async()=>{
  localStorage.setItem('solopi.lab.deviceGroup.pending.v1',JSON.stringify({requestId:'original-id',clientId:'client-a',tool:'save_device_group',args:{name:'Official group',alias:'Desk B',members:catalog().groups[0].members,enabled:false}}));
  render(<DeviceGroupsPanel/>);fireEvent.click(await screen.findByRole('button',{name:'核对原请求'}));await screen.findByText('设备组已保存到目标电脑。');expect(api.lab.mock.calls.some(c=>c[0]==='commands/original-id')).toBe(true);expect(api.lab.mock.calls.some(c=>c[0]==='commands')).toBe(false);expect(localStorage.getItem('solopi.lab.deviceGroup.pending.v1')).toBe(null);
 });
 it('does not send a mutation if saving the recovery record fails',async()=>{
  const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Storage unavailable');});
  try{render(<DeviceGroupsPanel/>);fireEvent.click(await screen.findByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'保存设备组'}));await screen.findByText('Storage unavailable');expect(api.lab.mock.calls.some(c=>c[0]==='commands')).toBe(false);}finally{storage.mockRestore();}
 });
 it('edits the original pairing and revision, retains official code, and shows the saved disabled alias',async()=>{
  render(<DeviceGroupsPanel/>);fireEvent.click(await screen.findByRole('button',{name:'编辑'}));
  expect((screen.getByRole('textbox',{name:'设备组别名'}) as HTMLInputElement).value).toBe('Desk A');
  expect((screen.getByRole('combobox',{name:'phone-sn的设备类型'}) as HTMLSelectElement).value).toBe('phone');
  expect((screen.getByRole('combobox',{name:'glass-sn的设备类型'}) as HTMLSelectElement).value).toBe('glasses');
  fireEvent.change(screen.getByRole('textbox',{name:'设备组别名'}),{target:{value:'Desk B'}});fireEvent.click(screen.getByRole('checkbox',{name:'启用设备组'}));fireEvent.click(screen.getByRole('button',{name:'保存设备组'}));
  await screen.findByRole('status');const call=api.lab.mock.calls.find(c=>c[0]==='commands')!;expect(call[1].args).toMatchObject({groupId:'group-a',expectedRevision:7,code:'desk-a',alias:'Desk B',enabled:false,members:catalog().groups[0].members,confirm:true});
  expect(screen.getByText('已停用')).toBeTruthy();expect(screen.getByText('Desk B')).toBeTruthy();
 });
 it('uncertain transport keeps the exact original request and retry reads without repeating POST',async()=>{
  api.lab.mockImplementation(async(path:string)=>{if(path==='catalog')return {items:[catalog()]};if(path==='commands')throw Error('Disconnected after send');return {status:'succeeded',result:{success:true,group:catalog().groups[0]}};});
  render(<DeviceGroupsPanel/>);fireEvent.click(await screen.findByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'保存设备组'}));
  await screen.findByText('Disconnected after send');expect((screen.getByRole('textbox',{name:'设备组别名'}) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'核对原请求'}));await screen.findByRole('status');expect(api.lab.mock.calls.filter(c=>c[0]==='commands')).toHaveLength(1);const original=api.lab.mock.calls.find(c=>c[0]==='commands')![1];expect(api.lab.mock.calls.some(c=>c[0]==='commands/'+original.requestId)).toBe(true);
 });
 it('a stale revision is reported and does not overwrite the refreshed group',async()=>{
  api.lab.mockImplementation(async(path:string)=>path==='catalog'?{items:[catalog()]}:path==='commands'?{}:{status:'failed',result:{success:false,errorCode:'GROUP_REVISION_CONFLICT'}});
  render(<DeviceGroupsPanel/>);fireEvent.click(await screen.findByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'保存设备组'}));await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toContain('已被更新');expect(api.lab.mock.calls.filter(c=>c[0]==='commands')).toHaveLength(1);
 });
});
