import {afterEach,it,expect} from 'vitest';
import {cleanup,render,screen,fireEvent,within} from '@testing-library/react';
import {useState} from 'react';
import {PageHeaderSlot,PageHeaderActions} from '../src/components/PageHeaderActions';
afterEach(cleanup);
function Page(){const [creating,setCreating]=useState(false);return <section data-testid="body"><PageHeaderActions><button onClick={()=>setCreating(v=>!v)}>创建任务</button></PageHeaderActions>{creating?<form aria-label="创建任务表单"/>:<p>任务列表</p>}</section>}
function Shell({page=true}:{page?:boolean}){const [host,setHost]=useState<HTMLDivElement|null>(null);return <PageHeaderSlot.Provider value={host}><header><h1>测试任务</h1><div ref={setHost}/></header><main>{page&&<Page/>}</main></PageHeaderSlot.Provider>}
it('has a single heading and hosts working page actions in the top header',()=>{render(<Shell/>);const top=screen.getByRole('banner');expect(within(top).getByRole('button',{name:'创建任务'})).toBeTruthy();expect(within(screen.getByTestId('body')).queryByRole('button')).toBeNull();expect(screen.getAllByRole('heading')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'创建任务'}));expect(screen.getByRole('form',{name:'创建任务表单'})).toBeTruthy()});
it('removes old page actions on navigation without leaving duplicate controls',()=>{const view=render(<Shell/>);view.rerender(<Shell page={false}/>);expect(screen.queryByRole('button',{name:'创建任务'})).toBeNull();expect(screen.getAllByRole('heading')).toHaveLength(1)});
