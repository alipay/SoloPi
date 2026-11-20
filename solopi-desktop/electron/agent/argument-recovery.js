// Validation failures are not operations. Give each newly failing tool one
// correction opportunity without replaying successful calls or coercing args.
function createArgumentRecovery() {
 const pending=new Map();let rounds=0;
 return {
  reset(){pending.clear();rounds=0;},
  next(failed=[],valid=[]){
   const names=new Set(failed);
   for(const name of valid)if(!names.has(name))pending.delete(name);
   for(const name of names)pending.set(name,(pending.get(name)||0)+1);
   rounds=pending.size?rounds+1:0;
   if([...pending.values()].some(count=>count>=2)||rounds>=6)throw Object.assign(
    Error('工具参数纠正未通过，已停止本轮；无效调用未执行，已完成操作保留。'),{code:'UNRESOLVED_TOOL_ARGUMENTS'});
   return {names:[...pending.keys()],attempt:pending.size?Math.max(...pending.values()):0};
  },
  get unresolved(){return pending.size>0;},
 };
}
module.exports={createArgumentRecovery};
