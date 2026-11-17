// Optional bridge: browser chat never requires an Electron runtime.
export {};
declare global { interface Window { glassbox?: {ipcRenderer:{invoke:(channel:string,...args:unknown[])=>Promise<any>;on?:(channel:string,listener:(...args:any[])=>void)=>void;removeListener?:(channel:string,listener:(...args:any[])=>void)=>void}} } }
