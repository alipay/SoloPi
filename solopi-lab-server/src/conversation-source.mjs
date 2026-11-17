// Immutable, bounded source snapshots. No model summary or completion inference.
const fail=(message)=>{throw Object.assign(Error(message),{code:'SOURCE_QUOTE_INVALID',status:422})};
export function conversationSnapshot({source,messages,messageId,quote,capturedAt,coverage='provided-transcript'}){
 if(!Array.isArray(messages)||!messages.length||new Set(messages.map(m=>m.messageId)).size!==messages.length)fail('来源消息标识必须存在且不重复');
 const anchor=messages.find(m=>m.messageId===messageId);
 if(!anchor||!['user','assistant'].includes(anchor.role)||typeof anchor.text!=='string'||!quote||!anchor.text.includes(quote))fail('引用必须逐字来自实际来源消息');
 if(messages.some(m=>!m.messageId||!['user','assistant'].includes(m.role)||typeof m.text!=='string'))fail('对话来源格式无效');
 const start=anchor.text.indexOf(quote);
 return {schemaVersion:'solopi.conversation-source.v1',source,capturedAt,coverage,messages,anchor:{messageId,role:anchor.role,createdAt:anchor.createdAt??null,start,end:start+quote.length,quote}};
}
export function serverConversationSource(db,conversation,messageId,quote){
 const rows=db.prepare('SELECT id,channel,external_id,text,result_json,gmt_create FROM sa_message WHERE conversation_id=? ORDER BY rowid').all(conversation.id),stop=rows.findIndex(m=>m.id===messageId);
 if(stop<0)fail('来源消息不存在');
 const messages=[];
 for(const row of rows.slice(0,stop+1)){
  messages.push({messageId:row.id,role:'user',text:row.text,createdAt:row.gmt_create,externalMessageId:row.external_id});
  let result;try{result=JSON.parse(row.result_json||'null')}catch{}
  if(row.id!==messageId&&typeof result?.text==='string')messages.push({messageId:row.id+':assistant',turnId:row.id,role:'assistant',text:result.text,createdAt:result.completedAt??null});
 }
 // Retain complete messages, including the source message; never truncate a quote.
 const selected=[];let size=0;
 for(const m of messages.slice(-9).reverse()){const n=Buffer.byteLength(JSON.stringify(m));if(selected.length&&size+n>400000)break;selected.unshift(m);size+=n;}
 return conversationSnapshot({source:{channel:rows[stop].channel,conversationId:conversation.id,externalConversationId:conversation.external_id,url:'#/superagent?conversation='+encodeURIComponent(conversation.id)+'&message='+encodeURIComponent(messageId)},messages:selected,messageId,quote,capturedAt:new Date().toISOString(),coverage:{kind:'related-window',omittedBefore:messages.length-selected.length,omittedAfter:rows.length-stop-1}});
}
export function conversationView(body,meta,profile,input){
 if(meta.kind!=='conversation')return null;
 let snapshot;try{snapshot=JSON.parse(body.toString('utf8'))}catch{}
 if(!Array.isArray(snapshot?.messages)){if(!meta.metadata?.messageId||!profile.quote)return null;snapshot={source:{...meta.metadata,url:profile.url},messages:[{messageId:meta.metadata.messageId,role:meta.metadata.role||'user',text:body.toString('utf8'),createdAt:meta.metadata.createdAt??null}],coverage:'legacy-single-message'};}
 const messageId=snapshot.anchor?.messageId||profile.messageId||meta.metadata?.messageId,quote=snapshot.anchor?.quote||profile.quote;
 if(!messageId||!quote)return null;
 const value=conversationSnapshot({source:snapshot.source||meta.metadata,messages:snapshot.messages,messageId,quote,capturedAt:snapshot.capturedAt??null,coverage:snapshot.coverage||'historical-selected-transcript'});
 const offset=input.messageOffset??0,limit=input.messageLimit??5;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>10)throw Object.assign(Error('对话原文分页无效'),{code:'INVALID_PAGE',status:422});
 return {...value,...(snapshot.coverage==='legacy-single-message'?{legacySingleMessage:true}:{}),messages:input.includeMessages===true?value.messages.slice(offset,offset+limit):[],totalMessages:value.messages.length,messageOffset:offset,nextMessageOffset:input.includeMessages===true&&offset+limit<value.messages.length?offset+limit:null};
}
