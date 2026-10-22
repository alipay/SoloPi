// scrcpy Streamer frame metadata: big-endian uint64 flags/PTS + uint32 size.
const MAX_PACKET=8*1024*1024;
function createPacketParser(onPacket){
 let buffer=Buffer.alloc(0);
 return chunk=>{
  buffer=buffer.length?Buffer.concat([buffer,chunk]):Buffer.from(chunk);
  while(buffer.length>=12){
   const flags=buffer.readBigUInt64BE(0),size=buffer.readUInt32BE(8);
   if(!size||size>MAX_PACKET)throw Object.assign(Error('scrcpy 视频包长度无效'),{code:'INVALID_VIDEO_PACKET'});
   if(buffer.length<12+size)break;
   const timestamp=Number(flags&((1n<<62n)-1n));if(!Number.isSafeInteger(timestamp))throw Error('scrcpy 视频时间戳超出范围');
   onPacket({configuration:!!(flags&(1n<<63n)),type:flags&(1n<<62n)?'key':'delta',timestamp,data:Buffer.from(buffer.subarray(12,12+size))});
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
