export function cpBodyLimit(pathname){
 if(['/cp/lab/task-state','/cp/lab/reply'].includes(pathname))return 16*1024*1024;
 if(pathname==='/cp/lab/catalog')return 4*1024*1024;
 return 1_000_000;
}
// Read the transport envelope once. Rejected bodies never reach authenticated dispatch.
export function collectCpJson(req,res,pathname,accept){
 const chunks=[];let size=0,rejected=false;
 req.on('data',chunk=>{
  if(rejected)return;
  size+=chunk.length;
  if(size>cpBodyLimit(pathname)){
   rejected=true;chunks.length=0;
   res.writeHead(413,{'Content-Type':'application/json'});
   res.end(JSON.stringify({error:{code:'INPUT_TOO_LARGE',message:'Request body exceeds route limit',retryable:false}}));
  }else chunks.push(chunk);
 });
 req.on('end',()=>{
  if(rejected)return;
  let body=null;
  try{if(chunks.length)body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'VALIDATION_FAILED',message:'invalid JSON',retryable:false}}));return;}
  accept(body);
 });
}
