# SoloPi 鸿蒙版

## Introduction (简介)

SoloPi是一个无线化、非侵入式的HarmonyOS自动化工具，目前拥有性能测试这项主要功能，后续将会开放录制回放、一机多控，能够为广大测试开发人员节省宝贵时间。
由于目前鸿蒙HarmonyOS部分最新API未发布，因此相关源码未提交，只先提交了相应的安装包和可执行文件，待鸿蒙发布之后，我们将尽快提交。

## Hope (愿景)

希望该项目可以让手机应用测试自动化起来，让测试人员摆脱那些枯燥的重复性工作。

## Features (功能)

#### 性能工具

SoloPi能够记录待测应用的各项指标，你可以在悬浮窗中观察实时更新的数据，也可以对性能数据进行录制，在录制结束后查看图表；


#### 录制回放（敬请期待）
#### 一机多控（敬请期待）

## Discuss (讨论群)

面向行业测试相关从业人员，对工具有什么意见或者建议的话也欢迎Issue、PR或加群讨论。

- 钉钉群：

## Limitation (限制)

- hdc
- HarmonyOS SDK 11+

## Installation (安装)

#### 下载配置HarmonyOS SDK路径

#### 连接设备并开启热点（确保PC与手机在同一网络）调试端口

   请先连接设备到PC，通过下方命令检查设备是否与电脑建立好连接。

   Windows：

   ```bash
   %HARMONYOS_SDK%\openharmony\11\toolchains\hdc.exe list targets
   ```

   macOS或Linux：

   ```shell
   %HARMONYOS_SDK%\openharmony\11\toolchains\hdc list targets
   ```
#### 打开SoloPi，进入到性能测试界面

#### 在PC端运行可执行文件solopiclient

#### 勾选所需要测试的性能项

#### 下载打包好的solopi-oh.hap，或者clone源码在本地编译，具体在SoloPi中的操作可以参考： [第一次使用](../../wikis/FirstUse)

    命令安装:
    hdc install solopi-oh.hap

## Compiling (编译)

编译环境：
* macOS 13.2.1
* DevEco Studio 4.1 Canary2
* hvigor-3.2.1-s
* API 11

## 代码导读

- common: 常量、实体对象及一些工具类。
- component: 自定义UI组件。
- controller: 性能项控制器。
- entryability: 页面入口。
- manager: 悬浮窗控制管理。
- pages: 应用各个页面。
- provider: 数据内容提供器。
- socket: Socket通讯代码逻辑。
- viewmodel: 对应页面的model。

## Related projects (相关的项目)

可以在 [版权信息](licenses/NOTICE.md) 中进行查看

## Contribution (参与贡献)

   独乐乐不如众乐乐，开源的核心还是在于技术的分享交流，当你对开源项目产生了一些想法时，有时还会有更加Smart的表达方式，比如(Thanks to uiautomator2)：

   - 我们的业务需要这项功能 ==> 我加了个功能，可以在很多场景用到，已经提交MR了。

   - 这块儿功能有更详细的文档吗？ ==> 这块内容我改了一下，更方便使用了，帮忙合并一下。

   - 我在XXX上怎么用不了啊？ ==> 在XXX手机上功能有点问题，我已经修复了。

   - 我刚用了XXX功能，怎么和文档上不一样啊？ ==> 我根据文档试用了一下，碰到了一些坑，这是我在ATA、Lark发的踩坑贴，有些内容可以补充一下。

   - 这个是不是一直维护啊？ ==> 我能做些什么？

   当然，Star、Fork、Merge Request、Issue等功能也随时欢迎大家使用哈！

   如果你有什么好的想法，也可以与我们直接联系，进行更加深入的讨论，我们希望将这套移动端的测试工具框架进行更好的推广，欢迎大家多多宣传。

## License (协议)

This project is under the Apache 2.0 License. See the [LICENSE](LICENSE) file for the full license text.

```text
Copyright (C) 2015-present, Ant Financial Services Group

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

 	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## Disclaimer (免责声明)

[免责声明](Disclaimer.md)