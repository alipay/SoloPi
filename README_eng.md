# <img src="assets/icon.png" width="48" /> SoloPi

[![GitHub stars](https://img.shields.io/github/stars/soloPi/SoloPi.svg)](https://github.com/soloPi/SoloPi/stargazers) [![GitHub license](https://img.shields.io/github/license/soloPi/SoloPi.svg)](https://github.com/soloPi/SoloPi/blob/master/LICENSE) [![GitHub release](https://img.shields.io/github/release/alipay/SoloPi.svg)](https://github.com/soloPi/SoloPi/releases) [![API](https://img.shields.io/badge/API-18%2B-brightgreen.svg?style=flat)](https://android-arsenal.com/api?level=18) [![TesterHome](https://img.shields.io/badge/TTF-TesterHome-2955C5.svg)](https://testerhome.com/opensource_projects/82)

> SoloPi is a wireless, non-invasive testing tool for automatic Android software testing. The Beta version has 3 main features: record and replay, performance testing, multi-device compatibility testing(OneToMany).

### [Features](#1)<br/>
### [Getting started](#2)<br/>
### [Folders and description](#3)<br/>
### [Contributing](#4)<br/>
### [Attributions](#5)<br/>
### [License](#6)<br/>
### [Disclaimer](#7)<br/>


## <span id="1">Features</span>

### 1. Record and replay

SoloPi captures all actions performed during tesing sessions so that issues can be identified and resolved more quickly. The recording can be played on any devices. All these actions can be done on just one single phone.

![Recording playback](assets/replay.gif)

The video tutorial:

**[Record the testing on a mobile game.](https://gw.alipayobjects.com/mdn/rms_e29b5f/afts/file/A*ym07T6nACDIAAAAAAAAAAABkARQnAQ)**

**[Record the testing on a native phone app.](https://gw.alipayobjects.com/os/basement_prod/3472d35c-bd57-4c82-8112-5dcde42fcb32.mov)**


### 2. Performance testing

* SoloPi is able to record and show the app's performance data such as CPU, memory, internet speed while do the testing. The performance window with selected testing metrics will float on top. After testing, you can check each testing parameter with generated data graphs.

* Besides, SoloPi can change testing environment to simulate certain situations. For instance, slow down the internet speed to simulate a situation when the internet is bad while using the app.

* SoloPi also add a function to calculate app launch time. This tool to the most extent, shows the actual launch time. This calculator function can be incorporated with UI automatic tests by sending broadcast messages.

![Performance analysis](assets/performance.gif)

The video tutorial:

**[Use the performance analysis function](https://gw.alipayobjects.com/os/basement_prod/1996390b-9ec8-4046-8ce8-459afa05d6c5.mov)**

**[Use the launch time calculator](https://gw.alipayobjects.com/os/basement_prod/4e82ca85-13fc-4de2-82ff-a9079344f5ef.mov)**

### 3. Multi-device compatibility testing

SoloPi supports simultaneous multi-device compatibility testing which is controlled by one device. So it enormously improves the efficiency of testing on different devices.

![Multi-device testing](assets/oneToMany.gif)

The video tutorial:

**[Simultaneous multi-device testing](https://gw.alipayobjects.com/os/basement_prod/971b5467-3db0-4781-86e3-15b3907323f6.mov)**

## <span id="2">Getting started</span>

> Open source SoloPi excludes the multi-device compatibility testing feature since it's still unstable.

### 1. Establishing a build environment

- macOS 10.14.3
- Android Studio 3.2
- **Gradle 4.4（Upgrading is not recommended.）**
- **CMake 3.6.4111459（Upgrading is not recommended.）**
- Ndk 15.2.4203819
- TargetApi 25
- MinimumApi 18
- **Note: Turn off instant run function in Android Studio. Otherwise the app does not work.**

### 2. Downloading and setting Android SDK path

- Download SDK Platform [here](https://developer.android.com/studio/releases/platform-tools#downloads).

- Unzip it and add the path to the system environment variable `ANDROID_SDK=${sdk path}` . You can also refer to articles such as how to set adb system environment variable.

**NOTE:**
For system above Windows 10, it takes effect immediately in a new command line window, while for older versions of system, you need to restart the computer. For Linux and MacOS, you can test if it works with `echo $ANDROID_SDK`.

### 3. Turning on on-device developer mode

- Open the Settings app.
- (Only on Android 8.0 or higher) Select System.
- Scroll to the bottom and select About phone.
- Scroll to the bottom and tap Build number 7 times. The system will show ‘You are now a developer.’ (messages may vary.)
- Return to the previous screen to find Developer options near the bottom. Toggle the options on and enable USB debugging

### 4. Known issues

- For VIVO devices, if there’s an option like ‘USB security access’ under developer options, it needs to be toggled on, otherwise recording and multi-device testing function may not work.

- For Xiaomi devices, under developer options, USB installation and USB debugging also need to be toggled on. Besides, you also need to turn on ‘后台弹出界面’ permission of SoloPi (System Settings -> App Management -> SoloPi -> Permissions).

- For MEIZU devices, if the application to be tested contains highly secured functions like payment function, the secure payment function in the system needs to be turned off.

- For HUAWEI devices, under developer options, you need to turn on ‘USB debugging’ and ‘allow ADB debugging in charge only mode’ option. Otherwise, when the USB cable is unplugged, the ADB debugging is also shut down.

- For  OPPO devices, system would ‘unchecking’ the ‘USB debugging’ every 10 minutes, leading to the unavailability of SoloPi. To solve it, keep connecting the phone to the computer.

- **It's highy recommandded to turn off safety input method in system language settings (if it has), otherwise text input may not work when input password or something else.**

### 5. Debugging apps over Wi-Fi

#### 5.1 Connect the device to PC via USB and make sure debugging is working.

When the device is connected to the PC, the device should pop up 'Allow USB debugging?' or similar messages. Click 'Yes'.

Check if the connection is successful in command line:

Windows: 
```bash
   %ANDROID_SDK%\platform-tools\adb.exe devices
```
MacOS/Linux:
```shell
   $ANDROID_SDK/platform-tools/adb devices
```

If it returns with the device number, then the connection is successful.

#### 5.2 Make the connection

> **Note:** Windows system may need Android device driver to make a successful connection. Devices driver can be downloaded on device's official website. You can also download the phone manager which includes device driver.

> **Note:** If the command line dosen't return `device`, make sure the device driver is installed successfully and the USB debugging is turned on. For some device, the connection mode needs to be `Media Transfer Protocal`(MTP).

For single device,

Windows: 
```bash
   %ANDROID_SDK%\platform-tools\adb.exe tcpip 5555
```

macOS/Linux：
```shell
   $ANDROID_SDK/platform-tools/adb tcpip 5555
```

The device may show `restarting in TCP mode port: 5555` to remind you the wi-fi ADB debugging mode is on.

For multiple devices,

Find the device number which is the serial number before `device` and save it.

Windows：

```bash
   %ANDROID_SDK%\platform-tools\adb.exe -s ${serial number} tcpip 5555
```
macOS/Linux：

```shell
   $ANDROID_SDK/platform-tools/adb -s ${serial number} tcpip 5555
```

#### 5.3 Downloading SoloPi

You can either download SoloPi.apk or clone the repository.

## <span id="3">Folders and description</span>
In the folder src,
- app: The business logic of the application.
- shared: The core function of the application.
- common: The application architecture.
- mdlibrary: Proxy generation of ExportService.
- permission: Permission management.
- AdbLib: ADB connection.
- androidWebscoket: Android WebSocket.

## <span id="4">Contributing</span>

This project is mainly open to developers who want to do software testing. If you have any suggestions or questions, you can open an issue, send a PR, or leave a message at our page at [TesterHome](https://testerhome.com/topics/node152).

If you like our project, please fork/⭐Star this project!

## <span id="5">Attributions</span>

We want to thank those [third party libraries](https://github.com/ruoranw/SoloPi/blob/master/NOTICE.md) used in this project without which this project couldn't be completed.

## <span id="6">License</span>

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


## <span id="7">Disclaimer</span>

[Disclaimer](Disclaimer.md)




