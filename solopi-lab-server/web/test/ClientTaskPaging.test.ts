import {expect,it,vi} from 'vitest';
import {listClientTasks} from '../src/api/client-tasks';
import {readDesktop} from '../src/api/client-task-read';
vi.mock('../src/api/client-task-read',()=>({readDesktop:vi.fn()}));
it('renders the first task page before a slow history page finishes, then retains every origin',async()=>{
 let release!:(value:any)=>void;const delayed=new Promise<any>(r=>release=r),pages:any[]=[];
 vi.mocked(readDesktop).mockImplementation(async(_client,_tool,args)=>args.offset===0?{tasks:[{id:'cli',status:'success'}],nextOffset:1}:delayed);
 const pending=listClientTasks({clientId:'computer',hostname:'host'},new AbortController().signal,{},rows=>pages.push(rows));
 await vi.waitFor(()=>expect(pages).toHaveLength(1));expect(pages[0][0].id).toBe('cli');release({tasks:[{id:'agent',status:'failed'}],nextOffset:null});expect((await pending).map(t=>t.id)).toEqual(['cli','agent']);
});
it('reads known history pages with at most three concurrent Client queries and preserves offset order',async()=>{
 let active=0,maximum=0;const releases:((x:any)=>void)[]=[];
 const row=(i:number)=>({id:String(i),name:String(i),status:'success'});
 vi.mocked(readDesktop).mockImplementation(async(_client,_tool,args)=>{const offset=Number(args.offset);if(offset===0)return {total:251,tasks:Array.from({length:50},(_,i)=>row(i)),nextOffset:50};active++;maximum=Math.max(maximum,active);await new Promise(r=>releases.push(r));active--;return {total:251,tasks:Array.from({length:Math.min(50,251-offset)},(_,i)=>row(offset+i)),nextOffset:offset+50<251?offset+50:null};});
 const pending=listClientTasks({clientId:'computer',hostname:'host'},new AbortController().signal);
 await vi.waitFor(()=>expect(releases.length).toBe(3));expect(maximum).toBe(3);releases.splice(0).forEach(r=>r(null));await vi.waitFor(()=>expect(releases.length).toBe(2));releases.splice(0).forEach(r=>r(null));
 expect((await pending).map(t=>t.id)).toEqual(Array.from({length:251},(_,i)=>String(i)));expect(maximum).toBe(3);
});
