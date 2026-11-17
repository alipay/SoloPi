export type TestPackage={id:string;kind:'phone'|'glasses'|'desktop';version:string;platform:string;name:string;size:number;notes:string;createdAt:number;sha256:string;downloadUrl:string};
export async function packageApi<T>(path='',init?:RequestInit):Promise<T>{const r=await fetch('/packages'+path,init);let v:any;try{v=await r.json()}catch{throw Error('安装包服务暂不可用，请稍后刷新')}if(!r.ok)throw Error(v.error?.message||'安装包操作失败');return v;}
export const packageKinds={phone:'手机测试包',glasses:'眼镜测试包',desktop:'solopi-desktop 安装包'};
export function formatBytes(n:number){return n>=1024**3?(n/1024**3).toFixed(2)+' GiB':n>=1024**2?(n/1024**2).toFixed(1)+' MiB':n>=1024?(n/1024).toFixed(1)+' KiB':n+' B'}
