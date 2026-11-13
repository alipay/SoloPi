const {parentPort,workerData}=require('node:worker_threads');
const {readBugreport}=require('./zip');
const fs=require('node:fs');
const path=require('node:path');
const {parseBugreport}=require('./parser');
try {
  parentPort.postMessage({phase:'读取并校验日志'});
  let report;
  if(['.txt','.log'].includes(path.extname(workerData.file).toLowerCase())){
    const fd=fs.openSync(workerData.file,'r');
    try{const size=fs.fstatSync(fd).size;if(size>256*1024**2)throw Error('文本日志超过256 MiB限制');const data=Buffer.alloc(size+1);const length=fs.readSync(fd,data,0,size+1,0);if(length>size)throw Error('文件读取期间发生变化');report={text:new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,length)),name:path.basename(workerData.file)};}finally{fs.closeSync(fd);}
  }else report=readBugreport(workerData.file);
  parentPort.postMessage({phase:'解析电池历史与应用活动'});
  parentPort.postMessage({result:parseBugreport(report.text,report.name)});
} catch(error) { parentPort.postMessage({error:error.message}); }
