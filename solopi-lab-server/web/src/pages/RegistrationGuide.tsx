import type {DataArea} from '../api/areas';
import {PackageLibrary} from './PackageLibrary';
export function RegistrationGuide(_props:{bootstrapArea:DataArea<unknown>}){
 return <><PackageLibrary/><details className="connection-guide"><summary>如何接入实验室</summary><ol><li>下载适合操作系统和架构的 solopi-desktop 安装包并安装。</li><li>在 Client 设置中心打开实验室连接，填写本站服务地址和实际组织、项目配置。</li><li>连接成功后，电脑及设备组会显示在实验室。设备组和测试任务继续由 Client 管理。</li><li>在“运行时与模型”页选择 Server 或目标电脑，配置 API 模型或该电脑已安装、已登录的 Agent CLI。</li></ol><p>注册所需的一次性令牌等配置由实验室管理员提供。</p></details></>;
}
