import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ImChat} from '../src/pages/ImChat';
const people=[{clientId:'A',hostname:'Mac A',updatedAt:Date.now()},{clientId:'B',hostname:'Mac B',updatedAt:Date.now()}];
let conversations:any[],writes:any[],unknown:boolean;
const direct=(id:string)=>({conversationId:id,kind:'direct',title:'Mac '+id,members:[id],messages:[{messageId:'m-'+id,sender:id,text:'收到 '+id,status:'sent',createdAt:Date.now()}]});
beforeEach(()=>{localStorage.clear();conversations=[direct('A'),direct('B')];writes=[];unknown=false;vi.stubGlobal('fetch',vi.fn(async(input,options)=>{
 const url=String(input),body=options?.body?JSON.parse(options.body):undefined;
 if(body){writes.push({url,body});if(url==='/lab/conversations'){const c={...body,conversationId:'group',messages:[]};conversations.push(c);return Response.json(c);}if(unknown){unknown=false;throw Error('connection lost');}const id=url.split('/')[3];const c=conversations.find(c=>c.conversationId===id);return Response.json({...c,messages:[...c.messages,{messageId:body.requestId,sender:'user',text:body.text,status:'sent',createdAt:Date.now()}]});}
 return Response.json(url==='/lab/catalog'?{items:people}:url==='/lab/conversations'?{items:conversations}:conversations.find(c=>c.conversationId===url.split('/')[3]));
}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('loads persisted Desktop DMs without login and keeps other DMs isolated',async()=>{
 render(<ImChat/>);expect(screen.queryByRole('button',{name:'登录'})).toBeNull();
 fireEvent.click(await screen.findByRole('button',{name:/Mac A/}));await screen.findByText('收到 A');
 fireEvent.click(screen.getByRole('button',{name:/Mac B/}));await screen.findByText('收到 B');expect(screen.queryByText('收到 A')).toBeNull();expect(writes).toEqual([]);
});
it('creates one server-owned group with exact members and submits one message',async()=>{
 render(<ImChat/>);await screen.findByRole('button',{name:/Mac A/});fireEvent.click(screen.getAllByRole('button',{name:'新建会话'})[0]);fireEvent.click(screen.getByRole('button',{name:'多人群聊'}));
 fireEvent.change(screen.getByRole('textbox',{name:'群名称'}),{target:{value:'协作群'}});for(const box of screen.getAllByRole('checkbox'))fireEvent.click(box);fireEvent.click(screen.getByRole('button',{name:'创建群聊'}));
 await screen.findByRole('heading',{name:'协作群'});fireEvent.change(screen.getByRole('textbox',{name:'消息'}),{target:{value:'分别回复收到'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 await screen.findByText('分别回复收到');expect(writes).toHaveLength(2);expect(writes[0].body).toMatchObject({kind:'group',title:'协作群',members:['A','B']});expect(writes[1].url).toBe('/lab/conversations/group/messages');expect(writes[1].body.requestId).toBeTruthy();
});
it('reconciles unknown delivery using the exact same payload and key',async()=>{
 render(<ImChat/>);fireEvent.click(await screen.findByRole('button',{name:/Mac A/}));await screen.findByText('收到 A');unknown=true;
 fireEvent.change(screen.getByRole('textbox',{name:'消息'}),{target:{value:'你好'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));fireEvent.click(await screen.findByRole('button',{name:'核对发送结果'}));await screen.findByText('你好');expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
});
it('reloads server history without submitting another task',async()=>{
 const first=render(<ImChat/>);fireEvent.click(await screen.findByRole('button',{name:/Mac A/}));await screen.findByText('收到 A');first.unmount();render(<ImChat/>);fireEvent.click(await screen.findByRole('button',{name:/Mac A/}));await screen.findByText('收到 A');await waitFor(()=>expect(writes).toEqual([]));expect(localStorage.getItem('solopi.im.chats.v1')).toBeNull();
});
