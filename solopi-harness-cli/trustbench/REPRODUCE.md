# TrustBench：仓库内构建、运行与审计入口

最新入口验收状态见 [Kimi-K3 参数化实验补全](PORTABLE-SMOKE.md)：用户授权后已在原 4 位置基础上仅补跑余下 20 条，24 个位置、12 个配对均通过严格审计，实际请求间隔至少一分钟。原 4 条逐字节保留并明确标为 carriedSlots，不重复计为新增执行。首次正常 direct 存储不一致的失败仍保留，未证明偶发问题已修复，也未将不同尝试合并成成功率。先前 401 是误选了另一份 Theta 配置，下面历史诊断按发生顺序保留。

最新结论见 [副作用实验结果](EFFECTS-RESULTS.md) 与 [动作安全 v2](SAFETY-V2.md)；早期任务 pilot 见 [收尾报告](PILOT-CLOSURE.md)。以下命令从 SoloPi 仓库根目录运行。
本次源码发布范围及可用证据见 [2026-10-21 发布说明](RELEASE-20261021.md)，不是公共排行榜。

公开的 transfer/threeway 两组为脱敏派生证据，离线审计入口见发布说明；历史 effects、coverage、pilot 等阶段的协议和结果摘要保留，但不包含其全部原始证据。下文历史入口不表示每个历史审计都能从普通 clone 直接通过。

新建实时模型实验时设置 `TRUSTBENCH_MODEL_ENDPOINT`（完整 HTTPS chat-completions URL）及 `TRUSTBENCH_MODEL_API_KEY`。模型固定为 Kimi-K3 的实验要求提供方支持该模型，不能静默换模型。公开历史协议中的 `.invalid` 地址和 `REDACTED-DEVICE` 仅为脱敏占位，不能直接用于执行；应新建实验组，不改写历史协议。离线审计不需要这些环境变量。

不需要本对话或 Codex 客户端。宿主机 CLI/审计使用 Python 标准库，仓库内运行无需 pip 安装；构建需联网下载 Android/Gradle 依赖。模型实验另外需要自备获授权的 HTTPS API 和凭据，离线测试/审计不需要凭据。

### 目录约定

在每个运行终端先设置；序列号通过 `adb devices -l` 获取，不使用作者设备号。下例使用仓库相邻的持久工作目录：

```sh
export TRUSTBENCH_WORK_DIR="$(pwd)/../trustbench-work"
mkdir -p "$TRUSTBENCH_WORK_DIR/apks" "$TRUSTBENCH_WORK_DIR/runs" "$TRUSTBENCH_WORK_DIR/evidence"
export TRUSTBENCH_SERIAL='替换为你已授权的测试设备序列号'
```

工作目录不纳入源码提交；APK、凭据、设备证据不要直接 `git add`。每次执行用 `mktemp -d "$TRUSTBENCH_WORK_DIR/runs/notes.XXXXXX"` 生成独立目录；要求目录尚不存在的执行器在该目录下使用 `run` 子路径。不要删除旧失败记录来获得漂亮结果。

## 1. 不碰手机、不调用模型的验收

需要 Python 3.9+；历史 `.tar.zst` 证据审计还需 `zstd`。

```sh
PYTHONPATH=solopi-harness-cli/src python3 -m unittest discover -s solopi-harness-cli/tests
```

以上只需源码。下面的历史 pilot 审计**另需原始证据**，普通 clone 不包含它们，不能保证直接通过：

```sh
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_release_audit \
  --index solopi-harness-cli/trustbench/pilot-closure-index-20261015.json
```

期望审计 `pilotClosurePassed=true`，但 `eligibleForModelRanking=false`。
历史证据无效记录必须保留；审计成功不把那条记录变成有效。
索引与历史 manifest 指向本机原始目录/归档，换机器需带上证据并在**索引副本**中重定位；缺文件应报错，不可跳过失败样本。
审核快照在 `pilot-closure-result-20261015.json`，不是原始证据替代品。

## 2. 真机复现前提

- Android 测试设备，ADB 已授权；安装独立 SoloPi 包 `com.alipay.hulu.trustbench`（端口 23343）和测试用 Notes 包。
- SoloPi 的无障碍、悬浮窗、后台/省电和“直接播放”权限就绪；系统权限由设备所有者确认。
- Notes 必须是可读回存储的测试 APK，不能把此 debug 配置用于生产 App。
- 每次使用新的空输出目录；所有运行和失败都保留；不批量重跑设备。
- 本轮已用 APK 哈希见收尾报告。重新构建可能因签名/时间戳产生不同哈希，必须新分组，不能标作同一二进制。

Notes 构建入口是 `solopi-harness-cli/trustbench/android-notes/build.sh OUTPUT_APK`，需要 Android SDK、build-tools（默认 34.0.0）、platform（默认 android-35）、JDK。脚本每次生成测试签名，覆盖安装前须核验签名；不要自动卸载已有应用。
SoloPi 构建使用 JDK 11、Gradle 6.1.1、SDK29/build-tools29.0.2/NDK21.1.6352462，在 `solopi-app` 内运行 `gradle :app:testDebugUnitTest :portal:assembleDebug -PtrustbenchIsolated --no-daemon`。不要把本机脏工作区的 HEAD SHA 当作已提交源码版本。

设置 `JAVA_HOME` 为已安装的 JDK 11 目录、`ANDROID_SDK_ROOT` 为你的 SDK 目录，并把 `$JAVA_HOME/bin`、SDK 的 `platform-tools` 和 `cmdline-tools/latest/bin` 加入 PATH。还需要 shell、zip、unzip、shasum。下面的 `sdkmanager --licenses` 由操作者阅读并接受，不自动代为同意。

```sh
java -version
sdkmanager --licenses
sdkmanager 'platform-tools' 'platforms;android-29' 'build-tools;29.0.2' \
  'ndk;21.1.6352462' 'platforms;android-35' 'build-tools;34.0.0'
(cd solopi-app && sh ./gradlew :app:testDebugUnitTest :portal:assembleDebug -PtrustbenchIsolated --no-daemon)
cp solopi-app/portal/build/outputs/apk/debug/portal-debug.apk "$TRUSTBENCH_WORK_DIR/apks/solopi.apk"
sh solopi-harness-cli/trustbench/android-notes/build.sh "$TRUSTBENCH_WORK_DIR/apks/notes.apk"
sh solopi-harness-cli/trustbench/android-effects-v2/build.sh "$TRUSTBENCH_WORK_DIR/apks/effects-v2.apk"
shasum -a 256 "$TRUSTBENCH_WORK_DIR/apks/solopi.apk" "$TRUSTBENCH_WORK_DIR/apks/notes.apk" "$TRUSTBENCH_WORK_DIR/apks/effects-v2.apk"
adb devices -l
```

仓库 wrapper 固定 Gradle 6.1.1，不需要历史 `/tmp/gradle-6.1.1`。下载失败应排查网络/代理，不能默默升级工具链后声称同版本复现。夹具编译脚本会使用临时中间目录并自动回收，但上述输出 APK 保存在持久工作目录。

仅在确认目标为可清空的测试设备后安装：

```sh
adb -s "$TRUSTBENCH_SERIAL" install -r "$TRUSTBENCH_WORK_DIR/apks/solopi.apk"
adb -s "$TRUSTBENCH_SERIAL" install -r "$TRUSTBENCH_WORK_DIR/apks/notes.apk"
adb -s "$TRUSTBENCH_SERIAL" install -r "$TRUSTBENCH_WORK_DIR/apks/effects-v2.apk"
adb -s "$TRUSTBENCH_SERIAL" shell am start -n com.alipay.hulu.trustbench/com.alipay.hulu.activity.SplashActivity
```

如返回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，停止覆盖安装：新夹具签名与已有安装可能不同，先保全所需数据并由操作者决定，不自动卸载。如返回 `INSTALL_FAILED_USER_RESTRICTED`，在手机开发者选项开启 USB 安装并由本人确认提示，然后重试同一安装命令。

手机上打开 **SoloPi TrustBench Debug**：系统设置→无障碍→已下载的应用/服务→该应用，允许服务；如被限制，先在应用信息页菜单允许受限制的设置。允许悬浮窗和后台运行，SoloPi 设置中开启“回放用例时直接播放”。厂商菜单名称可能不同，系统高风险授权须本人确认。以下 doctor 报告的 `accessibility` 和 `autoStart` 应为 true；不满足时不要启动实验。

```sh
./solopi-harness-cli/solopi-ai --serial "$TRUSTBENCH_SERIAL" \
  --package com.alipay.hulu.trustbench --device-port 23343 doctor
```

## 3. 当前长预算脚本对照

```sh
TRUSTBENCH_RUN_PARENT=$(mktemp -d "$TRUSTBENCH_WORK_DIR/runs/notes.XXXXXX")
export TRUSTBENCH_RUN_DIR="$TRUSTBENCH_RUN_PARENT/run"
./solopi-harness-cli/solopi-ai --serial "$TRUSTBENCH_SERIAL" \
  --package com.alipay.hulu.trustbench --device-port 23343 verify-run \
  --plan solopi-harness-cli/trustbench/agent-notes-v3-paced30-long-v1.plan.json \
  --agent-decisions solopi-harness-cli/trustbench/agent-notes-control-v3.json \
  --restart-app --artifacts "$TRUSTBENCH_RUN_DIR"
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_notes_storage \
  --run-dir "$TRUSTBENCH_RUN_DIR" --serial "$TRUSTBENCH_SERIAL" --apk "$TRUSTBENCH_WORK_DIR/apks/notes.apk"
```

只在 UI PASS 后立即读回存储，且在开始下一次 reset 前完成。不可覆盖旧存储收据。

## 4. 60 秒模型组

凭据仅通过 `TRUSTBENCH_MODEL_API_KEY` 环境变量注入，不写进文件、命令样例或报告。使用获授权的服务。
由本机密钥管理方式设置该变量，不把 key 发到聊天或提交到仓库。原实验使用的内部服务不是开源用户的必需依赖。换模型/服务、设备、预算或 APK 后必须使用新组，不能沿用旧组成绩；模型能力差异可能改变结果。
在独立终端运行桥接进程：

```sh
export TRUSTBENCH_MODEL_ENDPOINT='替换为你有权限的完整 HTTPS chat/completions API 地址'
export TRUSTBENCH_MODEL_WIRE_API=chat_completions
export TRUSTBENCH_MODEL_ID='替换为该服务实际支持的模型 ID'
export TRUSTBENCH_TARGET_PACKAGE=com.example.trustnotes
export TRUSTBENCH_MODEL_MAX_OUTPUT_TOKENS=4096
export TRUSTBENCH_MODEL_MIN_INTERVAL_SECONDS=60
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_model_bridge --port 18765
```

使用第 3 节相同命令，但将 `--agent-decisions ...` 替换为
`--decision-provider cloud --cloud-endpoint http://127.0.0.1:18765/decide --cloud-timeout 95`，并使用独立的新目录。
UI PASS 后立即运行同样的存储读回。结束后在桥接终端 Ctrl-C，确认进程退出。
60 秒是请求起点间隔；首条请求立即发出。等待计入 600 秒总预算/120 秒空闲预算和桥接 90 秒调用窗口。429 原样保留，不自动重试；多进程或共享 key 的流量不受本进程统一控制。

## 5. 判定器正负探针

将第 3 节计划换成 `notes-oracle-holdout-v1.plan.json`：

- 正例决策：`notes-oracle-holdout-positive-v1.json`；应 UI PASS，随后独立存储 PASS。
- 反例决策：`notes-oracle-holdout-false-done-v1.json`；应先通过清空检查，然后 `done` 被 Oracle 判为失败。CLI 非零退出是此注入的预期业务结果，但不是自动认定探针通过，仍需核验失败类别、前置和证据。
- 两例各用新目录，不能进入模型成功率分母，不产生虚假的模型收据。

将新路径加入新的索引副本后执行第 1 节审计。当前固定索引仅对应 2026-10-15 的原始证据。

## 6. 交付边界

此目录含任务、决策、冻结计划、实验组配置、显式结果索引、审计代码、测试、报告及复现说明。
最新 effects v2 的必要 JSON 证据已放入本仓库 `evidence/`，约 1.2 MiB；旧 pilot 大型归档仍采用外部引用。公开发布前仍需隐私、许可/安全审核及固定源码 tag；本次未执行任何公开发布或比赛提交。

## 7. 最新副作用实验：离线审核与新运行的区别

历史证据的最小目录结构是 `results.json` 加 24 个 `01-delete-unchanged-direct` 等位置目录；每个位置含 observation、model-input、request-start、decision、injection、action、storage-after、ui-after 的 JSON。完整保留原目录名和字节，不能只带最终指标快照。

当前仓库已带上这一批原始证据；也可以将整批移动到其他目录，然后修改以下变量：

```sh
export TRUSTBENCH_EVIDENCE_DIR="$(pwd)/solopi-harness-cli/trustbench/evidence/effects-v2-20261016"
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_effects_v2_audit \
  --protocol solopi-harness-cli/trustbench/effects-protocol-v2.json \
  --expected-index solopi-harness-cli/trustbench/effects-v2-final-20261016.json \
  --artifacts "$TRUSTBENCH_EVIDENCE_DIR"
```

期望 `validSlots=24`、`completePairs=12`、`pendingSlots=[]`、`expectedIndexVerified=true`。审计只从指定目录读取，原 `runDir` 的作者机器路径只作为来源记录，不再用于找文件；无需修改任何原始 JSON。缺文件、哈希变化或不一致会失败。不要用 `python -O` 或 `PYTHONOPTIMIZE` 禁用断言。该审计不访问模型、APK 或手机，也不证明再次真机运行必然得到相同结果。

**现有交付限制：**最新 effects v2 已具备仓库内原始证据，但旧 pilot 归档仍未包含，不能用最新批次代替其他组的历史审核。原证据保留作者路径、设备及请求标识以维持哈希，公开前须审核；此次仅在本地整理，未推送。历史 `BASELINE`、`SAFETY-*`、`EFFECTS-EXPERIMENT` 和索引中的 `/Users/...`、`/tmp/...` 均是当时的来源位置，不是安装前置条件。

**历史入口不改动，新环境使用参数化入口：**`trustbench_effects_v2.py` 仍绑定原设备/模型，保持历史源码哈希不变。新入口 `trustbench_effects_run` 在同一 CLI 模块中，支持指定设备、HTTPS Chat Completions 地址和模型，不依赖作者配置。它不支持 Responses 协议或自动模型别名回退：服务回执中的 model 必须与配置一致。保留原 24 位置、4096 输出 token、60 秒请求间隔和一次动作的副作用判定。

先按第 2 节构建新 APK，再离线生成**新组**（这一步不访问手机或模型，也不证明 APK 可安装）：

```sh
TRUSTBENCH_EFFECTS_PARENT=$(mktemp -d "$TRUSTBENCH_WORK_DIR/runs/effects.XXXXXX")
export TRUSTBENCH_EFFECTS_PROTOCOL="$TRUSTBENCH_EFFECTS_PARENT/protocol.json"
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_effects_run freeze \
  --protocol-id "effects-local-$(date +%Y%m%d-%H%M%S)" \
  --serial "$TRUSTBENCH_SERIAL" \
  --endpoint "$TRUSTBENCH_MODEL_ENDPOINT" --model "$TRUSTBENCH_MODEL_ID" \
  --fixture-apk "$TRUSTBENCH_WORK_DIR/apks/effects-v2.apk" \
  --solopi-apk "$TRUSTBENCH_WORK_DIR/apks/solopi.apk" \
  --output "$TRUSTBENCH_EFFECTS_PROTOCOL"
```

输出协议绑定本次源码和 APK 哈希，禁止覆盖已有协议或使用历史 v1/v2 组名。`preflight=not_run` 明确表示新环境尚未真机验证，不继承历史设备的通过状态。安装相应 APK、确认 doctor 和权限，并确保是可清空的测试设备后，可显式启动新组：

```sh
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_effects_run run \
  --protocol "$TRUSTBENCH_EFFECTS_PROTOCOL" \
  --artifacts "$TRUSTBENCH_EFFECTS_PARENT/run" --confirm-disposable-device
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_effects_v2_audit \
  --protocol "$TRUSTBENCH_EFFECTS_PROTOCOL" --artifacts "$TRUSTBENCH_EFFECTS_PARENT/run"
```

运行需要 `TRUSTBENCH_MODEL_API_KEY`，不需要启动第 4 节的桥接服务。执行前检查源码及设备上两个 APK 的哈希；每例检查初始存储、目标坐标、注入前后业务状态。异常即停止，保存不可用位置及未执行位置，不自动重试、不恢复旧组。新组不应传旧的 `--expected-index`，也不得并入历史成绩。未来若需要导出审计 JSON，应保存到 run 目录之外，避免成为待审计证据的一部分。

只验收新入口时，可在 `run` 命令增加 `--max-slots 4`，仅执行正常预览和目标替换的两对位置。结果标记为 `runPurpose=smoke`，剩余 20 个位置保留 pending；这不是完整实验组或新的可靠性成绩，不能用来覆盖旧结果。

如操作者随后明确要求补全，可以使用现有仓库的 `tools/trustbench_continue_effects.py`。它要求已审计且完整配对的成功前缀，拒绝重试任何已尝试位置；先验证旧索引、源码哈希和设备 APK，再把已完成证据逐字节复制到新目录，只执行尚未尝试的尾部。原目录和协议不改动，结果记录 carriedSlots、requestedSlots、原结果/索引哈希及续跑驱动哈希。保持一分钟请求间隔，遇到接口/设备异常或存储不一致即停止，不自动恢复。

```sh
PYTHONPATH=solopi-harness-cli/src python3 tools/trustbench_continue_effects.py \
  --source "$TRUSTBENCH_EFFECTS_PARENT/run" \
  --protocol "$TRUSTBENCH_EFFECTS_PROTOCOL" \
  --expected-index "$TRUSTBENCH_EFFECTS_PARENT/audit.json" \
  --artifacts "$TRUSTBENCH_EFFECTS_PARENT/continuation" --confirm-disposable-device
```

这里的 `audit.json` 必须先用前述离线审计生成并保存于原 run 外部；缺少有效索引不能跳过检查。新目录的结果同时含沿用和新执行位置，统计新增调用时必须扣除 carriedSlots，不能把复制记录算作新重复实验。完整性审计仍使用原协议；分批时序和源记录须在结果说明中披露。

## 8. 提交前的源码交付检查（不是另一个复现包）

```sh
git status --short
git diff --check
git ls-files solopi-harness-cli/trustbench solopi-harness-cli/src/solopi_harness solopi-harness-cli/tests
```

本地能跑不等于远端已包含文件。状态中 `??` 的源码、测试和文档须逐项审核后纳入正式提交；不要一并提交 APK、原始敏感证据或密钥。构建来源应记录已提交 revision（以及是否有未提交修改），不要把旧 tag 当作这次实现。此步骤不要求额外 ZIP 或另起项目。

2026-10-16 本次交付整理验证：332 项 Python 单测通过；将 effects v2 原始批次复制到独立目录，在不修改原始 JSON 的前提下完成 24 位置/12 配对与冻结索引逐文件哈希复核；删除迁移副本的一条动作收据后审计失败，不回退读取作者原目录。冻结执行源码哈希未变化。本次未重新编译 APK、调用模型或执行真机实验，构建说明不能当作本次干净环境构建通过的证明。

同日后续整理：参数化执行入口与测试已加入，341 项 Python 单测通过；最新 effects v2 的 192 个位置证据 JSON 和 results.json 已复制到仓库内并与旧索引校验一致。新入口仅做离线/模拟测试，尚未在新设备或新模型上运行；不能把历史 24 个实验视为新入口的真机验收。源文件、文档和证据仍需正式提交及公开前审核，本次未自动提交。

后续真机冒烟尝试（2026-10-16）：独立组 `effects-portable-smoke-20261016-A3nFCN`，`--max-slots 4`，60 秒间隔。doctor 全通过，安装 APK 哈希核验、夹具初始化、首次页面观察及模型输入生成成功；首个 Chat Completions 请求返回 HTTP 401，因此停止且无动作点击。只有一次请求，不能据此验证实际请求间隔；没有完成任何配对或业务存储结果验收。记录为 1 个 unavailable、23 个未运行，不算模型/Harness 性能失败；旧组未重跑。原始失败记录与协议见 [独立冒烟证据](evidence/portable-smoke-20261016-auth401/run/results.json)，约 28 KiB，不含密钥。当前卡点是获授权服务的凭据或接口权限；须解决后另建尝试，不覆盖此失败。加入冒烟上限测试后共 342 项 Python 单测通过。

随后核对本机 Theta 配置发现其实际使用 AnthropicChatModel 和 `/api/anthropic`，不是该冒烟的 Chat Completions 接口。按本机已安装客户端实现，以配置中的 key、Anthropic SDK 和配置列出的 GLM-5 做一次最小请求（关闭重试），仍得到 HTTP 401 / `authentication_error` / `API key not found`。该[认证探测](evidence/portable-smoke-20261016-auth401/theta-auth-check.json)不操作设备、不计入实验；不能仅凭此断言 key 过期或与历史成功时使用的字节相同。先解决当前配置的认证，再继续独立冒烟；不得把协议不同本身认定为已找到唯一根因。
