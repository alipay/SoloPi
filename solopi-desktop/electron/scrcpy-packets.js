// scrcpy Streamer frame metadata: big-endian uint64 flags/PTS + uint32 size.
const MAX_PACKET=8*1024*1024;
function createPacketParser(onPacket,{protocolMajor=3}={}){
 let buffer=Buffer.alloc(0);
 return chunk=>{
  buffer=buffer.length?Buffer.concat([buffer,chunk]):Buffer.from(chunk);
  while(buffer.length>=12){
   const flags=buffer.readBigUInt64BE(0),size=buffer.readUInt32BE(8);
   if(!size||size>MAX_PACKET)throw Object.assign(Error('scrcpy 视频包长度无效'),{code:'INVALID_VIDEO_PACKET'});
   if(buffer.length<12+size)break;
   // scrcpy 4 reserves bit63 for session metadata and moves both media flags.
   // Stream metadata is explicitly disabled by the matched server launcher.
   const major=typeof protocolMajor==='function'?protocolMajor():protocolMajor;
   const configBit=major>=4?62n:63n,keyBit=configBit-1n;
   if(major>=4&&flags&(1n<<63n))throw Error('意外的 scrcpy 会话元数据');
   const timestamp=Number(flags&((1n<<keyBit)-1n));if(!Number.isSafeInteger(timestamp))throw Error('scrcpy 视频时间戳超出范围');
   onPacket({configuration:!!(flags&(1n<<configBit)),type:flags&(1n<<keyBit)?'key':'delta',timestamp,data:Buffer.from(buffer.subarray(12,12+size))});
   buffer=buffer.subarray(12+size);
  }
  if(buffer.length>MAX_PACKET+12)throw Error('scrcpy 视频包缓冲超出限制');
 };
}
function avcCodec(data){
 for(let i=0;i+3<data.length;i++){
  let start=-1;if(data[i]===0&&data[i+1]===0&&data[i+2]===1)start=i+3;
  else if(data[i]===0&&data[i+1]===0&&data[i+2]===0&&data[i+3]===1)start=i+4;
  if(start>=0&&(data[start]&31)===7&&start+3<data.length)return 'avc1.'+Buffer.from(data.subarray(start+1,start+4)).toString('hex');
 }
 throw Object.assign(Error('scrcpy 配置包缺少 H.264 SPS'),{code:'INVALID_VIDEO_CONFIG'});
}
module.exports={createPacketParser,avcCodec,MAX_PACKET};
