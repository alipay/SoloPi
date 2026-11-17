// Transport adapters to the same native tools used by Desktop and CLI.
// Client owns device admission, argument validation and installation execution.
const str={type:'string',minLength:1};
export const DEVICE_TOOL_NAMES=['list_devices','download_file','install_apk','list_packages'];
export const deviceMaintenanceInstructions='设备维护（查询设备、下载文件、安装APK、回读已安装包）直接使用list_client_devices/download_client_file/install_client_apk/list_client_packages。仅核对用户指定的目标、设备在线与占用；不需要加载测试方案或用例Skill，不查询快捷脚本来替代已有安装工具。下载一次后复用返回的Client本地path，安装不等于业务测试通过。queued/running只读同一commandId，未知结果不重发。';
export function clientDeviceTools(dispatch){
 const make=(name,native,description,properties,required,readOnly)=>({
  name,description,readOnly,requiredSkills:[],
  schema:{type:'object',properties:{clientId:str,...properties},required:['clientId',...required],additionalProperties:false},
  execute:({clientId,...args},execution)=>dispatch({clientId,tool:native,args},execution)
 });
 return [
  make('list_client_devices','list_devices','直接读取目标Client当前在线设备。安装前核对真实serial；无需读取Skill或快捷脚本。',{runtime:{enum:['android','harmony']}},[],true),
  make('download_client_file','download_file','在目标Client下载用户指定的HTTP(S)文件，返回该Client本地path/字节数/SHA256。APK随后直接交install_client_apk；同一文件下载一次后复用path，无需测试Skill。',{url:{type:'string',pattern:'^https?://',maxLength:8192},fileName:str},['url'],false),
  make('install_client_apk','install_apk','复用Desktop/CLI原生安装工具，将Client本地APK安装到明确的Android serial，返回真实安装回执。先确认目标在线及设备占用。无需测试Skill、快捷脚本或创建用例；下载URL先用download_client_file。未知结果回读原commandId，不重发。',{serial:str,apkPath:str},['serial','apkPath'],false),
  make('list_client_packages','list_packages','安装后读取同一Client、同一设备的已安装包，核验真实回执。无需业务测试Skill。',{serial:str,runtime:{enum:['android','harmony']}},['serial'],true)
 ];
}
