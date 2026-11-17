import {expect,it,vi,afterEach} from 'vitest';
import {projectWorkingGroups,readWorkingGroups} from '../src/api/working-groups';
import {listClientTasks} from '../src/api/client-tasks';
import {readDesktop} from '../src/api/client-task-read';
vi.mock('../src/api/client-tasks',()=>({listClientTasks:vi.fn()}));
vi.mock('../src/api/client-task-read',()=>({readDesktop:vi.fn()}));
const catalog:any={clientId:'a',hostname:'A',devices:[{deviceId:'p',serial:'phone'},{deviceId:'g',serial:'glass'}],groups:[{groupId:'g1',name:'组一',members:[{deviceId:'p',role:'phone'},{deviceId:'g',role:'glasses'}]},{groupId:'idle',name:'空闲组',members:[{deviceId:'x',role:'phone'}]}]};
const task:any={id:'t',clientId:'a',name:'任务',status:'running',devices:{phone:{serial:'phone'},glasses:{serial:'glass'}}};
afterEach(()=>vi.resetAllMocks());
it('projects only working saved groups using exact role/physical identity',()=>{expect(projectWorkingGroups(catalog,[task]).groups.map(g=>g.group.groupId)).toEqual(['g1']);expect(projectWorkingGroups(catalog,[{...task,devices:{phone:{serial:'missing'}}}]).unmatched).toHaveLength(1);});
it('never assigns an ambiguous group or a deleted group',()=>{expect(projectWorkingGroups({...catalog,groups:[...catalog.groups,{...catalog.groups[0],groupId:'copy'}]},[task]).groups).toHaveLength(0);expect(projectWorkingGroups({...catalog,groups:[{...catalog.groups[0],deleted:true}]},[task]).unmatched).toHaveLength(1);});
it('asks Client for active summaries once, preserving every origin without report reads',async()=>{
 vi.mocked(listClientTasks).mockResolvedValue(['cli','agent','manual','ui'].map(source=>({...task,id:source,source})).concat([{...task,id:'done',status:'success'},{...task,id:'waiting',status:'pending'}]));
 const value=await readWorkingGroups(catalog,new AbortController().signal);expect(value.groups[0].tasks.map(t=>t.id)).toEqual(['cli','agent','manual','ui']);expect(readDesktop).not.toHaveBeenCalled();expect(listClientTasks).toHaveBeenCalledWith(catalog,expect.any(AbortSignal),{statuses:['running','stopping'],includeDevices:true});
});
