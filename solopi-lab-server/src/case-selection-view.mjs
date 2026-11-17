// Model-facing discovery only. Original tokens, full membership and revisions
// remain unchanged in the durable receipt used by atomic task submission.
const MAX_INLINE=5800;
const keep=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
export function caseSelectionView(receipt,args={}){
 const command=receipt?.payload?.tool==='list_cases';
 if(command && (receipt.status!=='succeeded'||receipt.result?.success!==true))return receipt;
 const result=command?receipt.result:receipt;
 if(result?.success!==true||!Array.isArray(result.cases))return receipt;
 const offset=Number.isSafeInteger(args.offset)?args.offset:Number.isSafeInteger(receipt.payload?.args?.offset)?receipt.payload.args.offset:0;
 const {selectionId,...rest}=result;
 // Put useful candidate metadata before opaque transport/version fields.
 const view={...keep(receipt,['receiptId','clientId','commandId']),success:true,
  ...(command?{commandStatus:receipt.status,selectionComplete:result.nextOffset===null}:{}),
  ...keep(rest,['total','nextOffset','selectionComplete','cases','libraries','folders','scopeSummary']),
  ...rest};
 if(selectionId!==undefined)view.opaqueSelectionStored=true;
 if(Array.isArray(result.caseIds)&&(result.caseIds.length>10||result.casesPreviewOnly===true)){
  delete view.caseIds;view.caseIdCount=result.caseIds.length;view.caseIdsStored=true;
 }
 if(JSON.stringify(view).length<=MAX_INLINE)return view;
 // A preview may shrink, but no ID, selector, or underlying membership is cut.
 const compact={...keep(view,['receiptId','clientId','commandId','commandStatus','success','total','selectionComplete','selectionRevision','selectorRevision','opaqueSelectionStored','caseIdCount','caseIdsStored']),
  cases:[],libraries:[],casesPreviewOnly:true,previewOffset:offset,nextOffset:offset};
 if(result.caseIds){compact.caseIdCount=result.caseIds.length;compact.caseIdsStored=true;}
 for(const candidate of result.cases){
  const row=keep(candidate,['id','caseId','name','libraryId','runnable','reviewStatus']);
  const libraries=(result.libraries||[]).filter(l=>l.id===row.libraryId).map(l=>keep(l,['id','name','branch']));
  const proposed=[...compact.libraries,...libraries.filter(l=>!compact.libraries.some(v=>v.id===l.id))];
  if(JSON.stringify({...compact,cases:[...compact.cases,row],libraries:proposed}).length>MAX_INLINE-300)break;
  compact.cases.push(row);compact.libraries=proposed;
 }
 const hidden=compact.cases.length<result.cases.length;
 compact.nextOffset=hidden?offset+compact.cases.length:result.nextOffset;
 compact.previewComplete=!hidden&&result.nextOffset===null;
 compact.previewReturned=compact.cases.length;
 compact.membershipStored=true;
 return compact;
}
export function toolContextView(tool,result,args){
 if(typeof tool.contextView==='function')return tool.contextView(result,args);
 // Both public search and command polling expose the same native list_cases
// receipt. Do not project unrelated commands or infer business intent.
 if(['search_client_cases','read_command'].includes(tool.name)&&result?.payload?.tool==='list_cases')return caseSelectionView(result,args);
 return result;
}

// Single-case discovery shows enough candidates to choose without exhaustive paging.
export function casePreviewArgs(args={}){return {limit:10,...args};}
