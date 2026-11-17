// The same stream state reaches IPC and HTTP projections; hosts own delivery cadence.
function reduce(previous,frame,now=()=>new Date().toISOString()){
 let state=previous;
 if(frame.type==='start')state={content:'',reasoning:'',toolCallCount:0,stage:'waiting',createdAt:now()};
 if(frame.type==='chunk'&&state){state={...state};const c=frame.chunk;if(((c.type==='text-delta'||c.type==='reasoning-delta')&&c.text)||(c.type==='block-start'&&c.blockType==='tool-call'))state.stage='receiving';if(c.type==='text-delta')state.content+=c.text;if(c.type==='reasoning-delta')state.reasoning+=c.text;if(c.type==='block-start'&&c.blockType==='tool-call')state.toolCallCount++;}
 if(frame.type==='end')return state&&(frame.outcome?.kind==='abandoned'||frame.outcome?.eventType==='assistant/attempt')?{...state,stage:'incomplete'}:undefined;
 return state;
}
module.exports={reduce};
