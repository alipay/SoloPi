# 视觉回归能力与收益验证追踪

这项能力让 GoalPath 在页面树提供的信息之外，结合当前截图选择可执行目标，并用独立的业务断言检查结果。本文按背景痛点、技术方案、实现与使用、收益四部分说明：哪些页面需要视觉信息，怎样公平比较图文输入，以及如何保留可复核的真机证据。当前 Android 画面绑定、候选约束、离线评测和受控场景已实现；受控 App 的 v5 pilot 已完成并审计全部 27 条 rules/text/image 记录，清理均通过。image 在四个正向任务上均通过，但无目标场景出现一次实际误点，未满足零错误动作门槛；默认继续使用 rules，MCP 入口与探索路径标准导出延后。本轮仅涉及离线受控 App，没有上传支付宝截图或页面内容；正式 240+80 轮尚未开始，180 样本数据集尚未完成。

## 一、背景与痛点

GoalPath 根据页面树构造候选，再由规则或模型选择动作。页面树能提供文案、控件角色、父子语义和状态，但有些差异只画在屏幕上：没有标签的图标要看图形含义，多个“查看”入口要区分它们对应的服务，布局变化后不能继续依赖原位置。弹窗遮挡、控件禁用和目标缺失又提出另一项要求：即使知道要点哪里，也必须判断当前能否执行。

选择正确入口之后，还要核对业务结果。“到了订单详情页”不能证明订单已支付；断言本身也需要验证，避免错误的预期被执行框架误判为通过。因此，受控测试同时覆盖正确选择、应当拒绝动作的情况，以及真实错误结果和故意错误的验收条件。下一部分的九个变体分别对应这些问题。

核心比较是：在相同候选池、相同模型和执行条件下，只增加当前截图，是否能提升正确选择及任务完成能力。候选扩展的作用另做消融。规则、任务、预期和计数口径先冻结，运行后保留失败、基础设施阻断与人工介入；独立预期不从实际结果反推，离线选择正确率和单次设备通过也不能直接推导稳定收益。

## 二、技术方案

### 2.1 当前画面与候选绑定

Android 视觉观察采用“页面树 → 整屏截图 → 新页面树”的采集顺序。比较前后页面语义指纹、目标包、前台窗口、屏幕尺寸及旋转状态；新观察 ID 必须变化，前后上下文必须一致。最多尝试三次，无法得到稳定绑定就阻断本次决策，保留采集现场。缺少设备侧 `visualContext` 时也阻断，不能从根节点尺寸猜测物理屏幕。

绑定证据包括 `observationId`、原始 PNG SHA256、宽高、`treeFingerprint` 和尝试次数。模型收到语义候选及其在原图中的 `visualBounds`；image 条件另外上传原始 PNG，当前实现不裁剪、不缩放、不画候选标注。text 条件仍采集和校验同一类截图，仅不上传图像，使采集开销与候选几何信息保持可比。

模型只能返回当前 `candidate_N` 或 `abstain`。本地把索引映射为已构造的动作；模型不能生成坐标、资源 ID、任意命令或新动作。实际动作仍经过现有页面及目标校验，最终通过与否由固定验收和清理结果决定。模型说完成、看见一张截图或 `stopWhen` 成立，都不能替代业务 Oracle。

### 2.2 rules、text、image 使用同一候选池

| 对照条件 | 决策模式 | 视觉输入 | 候选池 | 比较目的 |
|---|---|---|---|---|
| rules | rules | text，仅采集不上传 | expanded | 用稳定 resourceId 直接定位正确入口，衡量已有确定性能力 |
| 同模型 text | llm | text，仅采集不上传 | expanded | 提供任务、页面语义、候选和几何信息，作为图像增量对照 |
| 同模型 image | llm | image，上传绑定截图 | expanded | 在同一模型和同样文本信息上增加原始截图 |

规则基线故意保留强定位能力：中性的稳定 ID `visual_b2` 在图标无标签、入口换序和布局变化后仍可定位目标。这代表已有结构化标识可用时的确定性做法，不需要为视觉对照削弱它。模型请求不包含这条资源 ID 规则，也不按规则筛选候选。三个 arm 均使用 expanded 池，确保真实可点击但无标签的图标进入相同候选集合。

图像本身的作用只从同模型 text 与 image 的配对差异判断。两者保持相同 policy、plan、目标、候选池、预算、准备段、初态、清理、验收、实际模型版本及参数；text 也采集并校验截图，仅不向服务上传图像。因此该比较隔离的是增加图像后的影响。与 rules 的比较则回答在强规则基线之上，模型在哪些条件下有帮助、代价如何。

`semantic` 与 `expanded` 属于另一项消融：固定同一模型及 text/image 条件，只切换 `--goalpath-candidate-pool`，观察目标是否进入候选、拒答率和正确率如何变化。此结果单独列账，不能将 semantic/text 与 expanded/image 的差额直接称为图像收益。当前离线 evaluator 使用 manifest 中冻结的候选，不自动生成或切换候选池；做消融须先保存各池对应请求，按同一原始页面配对评估，并维持 split 隔离。

执行器与模型身份分别冻结：`runner={framework,mode,revision}` 描述执行框架，`model={provider,name,version}` 与 `config` 描述实际可调用模型 API 及参数。主试验的执行器均为 `solopi-goalpath`，text/image 使用同一实际 VLM、配置和执行器 revision；本轮内部服务预检使用 `Qwen3.8-Flash-Next`，服务回包返回相同模型 ID；不可变部署版本尚未由服务提供，正式协议仍保留待冻结状态。

补充试验的 `google/artemis` 是面向 Android 真机和模拟器的 Agent 框架，Flash/Pro 是执行 profile。协议提供独立的 `artemis-flash`、`artemis-pro` arm，并分别记录模式配置与实际后端模型。只读核验的上游提交为 [`351ca8422f7b5b54e80a9c1ce03a222e02415b6b`](https://github.com/google/artemis/commit/351ca8422f7b5b54e80a9c1ce03a222e02415b6b)，两模式须冻结同一个 revision，在共同支持的四条真实支付宝只读流程上对照；不能用受控 App 四组或 SoloPi 的 image arm 冒充 Artemis。目前尚未在设备上验证这四条流程的共同支持情况，`discovery.runnerSupport` 仍为 `unverified`，协议保持 draft。上游 AndroidWorld 的公开成绩不能替代支付宝流程证据。

### 2.3 四组九变体分别验证什么

受控 Demo 使用离线虚构订单，动态目标统一为“打开订单详情并检查已支付”。准备阶段选择组和变体，动态阶段只能从当前页面已构造的候选中选择动作，最后由固定业务 Oracle 和清理 Oracle 验收。九个变体的预期在执行前声明，表中列的是检验要求，实际状态由逐轮回执记录。

| 受控组 | 变体 | 画面或行为变化 | 要验证的问题与预期 |
|---|---|---|---|
| 无标签图标 | normal | 订单文档、配送卡车、会话气泡三个入口都无文字和内容描述 | 能否从图形含义选中订单入口；到达 `DETAIL` 且状态为“已支付”才通过 |
| 无标签图标 | reversed | 保留相同图标，颠倒入口顺序 | 正确选择是否依赖原来的位置或候选顺序；验收与 normal 相同 |
| 相似入口与布局 | normal | 三个控件同为“查看”，按竖向排列，由服务图形区分 | 同名、同类控件的文本不足以决定服务含义时，能否选对入口；验收为详情及“已支付” |
| 相似入口与布局 | reversed | 改为横向排列并颠倒入口顺序 | 布局和位置变化后能否继续辨认相同任务；验收保持不变 |
| 遮挡与禁用 | dialog | 真正的模态 Dialog 挡住订单页面，当前没有可用订单入口 | 应拒绝选择底层入口或其他服务；保留 `not_tested`，并独立核验没有错误动作，不计业务通过 |
| 遮挡与禁用 | disabled | 订单入口仍可见，但控件实际 disabled | 能否区分“看见目标”和“目标可执行”；应拒绝误点，保留 `not_tested` 并核验没有错误动作，不计业务通过 |
| 无目标与错误结果 | no-target | 移除订单入口，保留配送和会话入口 | 没有正确答案时能否拒答，避免为完成任务而点击干扰项；不计业务通过 |
| 无目标与错误结果 | wrong-result | 可以打开真实详情页，但订单状态为“已取消” | 必须实际到达 `DETAIL`，再由“已支付”Oracle 判失败；只验证到达页面不够 |
| 无目标与错误结果 | wrong-oracle | 详情页真实显示“已支付”，最终 Oracle 故意填写不可能匹配的哨兵值 | 先通过 `DETAIL` 和真实“已支付”检查，再由错误 Oracle 报 mismatch，验证框架不会错误放行；提前 blocked 不算完成此哨兵 |

每轮固定准备段选择组后等待 1200 ms，选择变体后再等待 1200 ms，然后严格核对 `page_state == VISUAL_ORDERS`，Dialog 变体核对 `VISUAL_DIALOG`。两次等待覆盖已观察到的辅助功能内容通知延迟，避免用前一页缓存解析下一目标或提前执行准备页 Oracle。每轮清理只执行一次返回场景选择动作，再统一等待 1200 ms，严格核对 `page_state == SCENARIOS`。真实 Dialog 使用其窗口内的 `visual_dialog_reset`，其余变体使用 `reset_button`。三个 arm 采用相同的两次准备等待与一次清理等待，全部计入相应阶段和端到端耗时，精确 Oracle 与动态预算保持不变。

### 2.4 评测协议与固定账本

| 项目 | 计划量 | 当前含义 |
|---|---:|---|
| 冻结截图数据集 | dev 60 + holdout 120 = 180 | 采集与冻结目标，尚非已完成数据 |
| 主试验 | 8 任务 × 3 arm × 10 轮 = 240 | rules / 同模型 text / 同模型 image 的计划账本 |
| Agent 模式补充试验 | 4 条共同支持的真实支付宝流程 × Artemis Flash/Pro × 10 轮 = 80 | `google/artemis` 框架运行模式比较，独立 arm 与 experimentId |
| 设备回归总量 | 240 + 80 = 320 | 待实际执行；不由 fixture 或离线 API 行数填充 |

八个计划任务为四个支付宝只读场景：提醒设置、充值页区域、扫码退出、通用设置；另四个受控 App 组：无标签图标、相似布局、遮挡/禁用、无目标/错误结果。Artemis 的 80 轮仅从前四条真实支付宝流程中取样，正式冻结还要求每条的 `discovery.runnerSupport` 明确记录 SoloPi、Artemis Flash、Artemis Pro 均已核验支持。支付宝实际入口仍待发现核验，不预设安装版本上的页面一定存在。充值等敏感区域只读定位，不提交真实交易。

这些是后续正式协议的计划量。本轮只执行 `com.solopi.fastpath.demo` 的受控 pilot，没有启动支付宝流程、Artemis 补充试验或 240+80 轮正式账本，也没有向模型服务发送支付宝截图、页面树或页面内容。

截图、语义请求和独立预期均按相对路径及 SHA256 冻结。相同页面及其变体使用同一个 `sourceGroupId`，按 `groupId` 关联样本，不能跨 dev/holdout；相同截图哈希也不能换名后跨 split。预期答案只由本地 judge 读取。dev 用于选择配置，配置冻结后再评估 holdout；holdout 不允许用 `--limit` 只挑一部分样本。

协议按固定 seed 生成任务/轮次块并交错各 arm，同一任务同一轮共享 `trialSeed`。同模型 text/image 的模型与配置身份必须一致；逐轮另核对 `runnerIdentity`，防止相同模型配置但不同执行器/模式的记录混入。当前示例协议是 draft，含未核验发现、共同支持状态、实际模型型号、执行器 revision 和待补的真实哈希；只能输出 `executable=false` 的草稿，不能据此启动正式账本或产生收益结论。

## 三、实现与使用

### 3.1 代码与当前交付状态

| 实现 | 已有能力 | 当前验证范围 |
|---|---|---|
| `visual_observation.py` | 页面树/截图/新页面树校验、原图与哈希证据 | 真机 1080×2400 PNG 已解码；v5 的 27 条受控记录已审计，长期稳定性尚未验证 |
| `goalpath.py`、`goalpath_vision.py` | 当前候选约束、text/image API、expanded 候选池 | 配置的实际 VLM 已通过兼容预检；受控页面图文对照已完成一轮 |
| `vision_collect.py` | 同次证据验证与原图／请求收集，预期保持未标注 | 已冻结 8 个 dev 决策上下文、4 个源组，holdout 为 0；不等于 8 个独立页面 |
| `vision_evaluate.py` | 冻结样本的四条件 API 评测，逐条记录失败 | 8 个 dev 上下文的 32 条评测已结束，含 2 次接口失败；图像条件对候选顺序仍敏感 |
| `vision_benchmark.py` | 320 轮调度、完整性核对、收益门槛、中文数据表 | 180 样本冻结与完整真实逐轮结果 |
| `prepare_controlled.py`、受控 Demo | 四组九变体，固定准备、探索、验收和清理输入 | v5 使用 preparation-settle-v4 修订，九变体三 arm 共 27 条执行与审计完成 |
| `solopi_ai.py` 的 HTTP 与动态执行器 | 4 秒空闲连接过期、dispatch 前持久化 proposal、独立实际回执 | 长模型推理后主动换连接；回执不确定时保留决策与 usage，不重放动作、不声明已执行 |
| `visual_report.py` | 本次运行原始整屏 PNG 的静态 HTML 证据页 | 27 条运行各自保留真机逐段截图、回执与报告 |

生成器中的 `declaredExpectation` 和 `deviceVerified=false` 表示输入约定。真机证据单独保存在每轮 report、timing、动作回执与原始截图中；运行某一变体不会把整个生成包自动改成“已验证”。早期基础设施试跑保存在 `output/vision-regression/pilot-internal/`、`pilot-internal-v2/` 以及后续各版本目录，原始失败不覆盖、不删除。最早三次未调用模型 API；随后暴露的准备页延迟、截图几何、清理同步和推理后 HTTP 空闲连接问题分别保留其现场，不能合并成模型拒答或任务成败。当前 v5 pilot 目录为 `output/vision-regression/pilot-internal-v5/`，使用修订 `controlled-vision-preparation-settle-v4` 的冻结输入，并采用同一份 4 秒空闲连接过期与 dispatch journal 实现；v3/v4 的冻结输入与结果保持原样。

HTTP 连接从上次成功响应后计时，空闲达到 4 秒时在下一次请求前主动关闭并重连，统计 `idleExpiredConnections`；失败请求不自动重试。动态执行器先将 decision、模型 usage、实际独立 `stepId` 与原始 `observationId` 写为 `state=submitted`，再 dispatch；只有收到实际结果才追加结果并更新 `result_received`。回执传输失败时保留未确认 proposal，不能据此宣称动作已执行或业务通过。collector 可以收集其请求作为待标注素材，但仍保持 `evaluationReady=false`。

以下命令均从 **SoloPi 仓库根目录** 执行，产物统一写入已被 Git 忽略的 `output/vision-regression-work`。先设置源码入口；Python 环境需具备项目 `vision` 可选依赖中的 Pillow，依赖声明见 `solopi-skill/scripts/harness/pyproject.toml`。

```sh
export PYTHONPATH="$PWD/solopi-skill/scripts/harness/src"
export PYTHONDONTWRITEBYTECODE=1
```

### 3.2 模型服务配置

端点、允许的 host 和实际 VLM 由运行环境显式配置。下面均为需替换的占位值；公开指南不固定任何私有服务主机名，实际端点保存在已忽略的本轮运行 metadata 中。凭据仅由调用者预先设置环境变量，文档不提供凭据值，运行产物也不保存认证头。

```sh
export VISION_API_ENDPOINT="https://<approved-vision-host>/v1/chat/completions"
export VISION_API_HOST="<approved-vision-host>"
export VISION_MODEL_ID="<configured-actual-vlm>"
export VISION_HARNESS_PACKAGE="com.alipay.hulu"
export VISION_CONTROL_PORT="23343"
```

使用本轮 FastPath 调试副本时，将 `VISION_HARNESS_PACKAGE` 改为 `com.alipay.hulu.fastpath`，`VISION_CONTROL_PORT` 改为 `23344`；标准 SoloPi 包使用上面的默认值。本轮已核验准确 FastPath 副本的辅助功能和内部 ADB 均为 ready；每次更换设备或安装副本后，仍需核对对应包的就绪状态。

调用前确认 `VISION_API_KEY` 已在当前进程环境中设置。调用使用显式配置端点的 OpenAI 兼容协议，协议名称不代表服务提供者。实际 VLM 身份需同时核对请求配置与服务回包；本轮已观察到回包模型 ID `Qwen3.8-Flash-Next`，服务没有提供不可变部署版本。`--goalpath-max-output-tokens` 可显式配置，本轮 text/image 固定为 2048。首次 128 token 预检因推理输出占用预算而截断，该失败及实际用量保留，不能删掉后宣称接口一次成功；2048 预算也不能保证每次都返回有效 choice，失败须逐轮记录。

已完成的正式 transport 合成预检中，同一模型在 text 条件选择 `abstain`，在 image 条件正确选择蓝色区域。这只验证认证、严格 JSON、PNG 输入和候选返回的兼容性；合成图不属于真实页面样本，不计入 180 条数据或真机通过率。真实 App 截图须在明确发送范围内另行执行。

### 3.3 生成并检查受控输入

```sh
python3 solopi-skill/scripts/harness/examples/vision-regression/prepare_controlled.py \
  --output ./output/vision-regression-work/controlled-inputs

python3 -m solopi_harness verify-validate \
  --plan ./output/vision-regression-work/controlled-inputs/controlled-icon/normal/plan.json
```

输出目录必须不存在。生成过程编译并静态校验 requirement、plan、policy 和固定段 case，不连接设备或模型，不生成截图、实际回执或执行通过记录。

### 3.4 设备侧同池对照入口

下面是已核对参数的受控 App 单场景运行方式。执行前需从实际环境设置 `VISION_DEVICE_SERIAL`、`VISION_MODEL_ID`、`VISION_API_ENDPOINT`、`VISION_API_HOST`，并在 `VISION_API_KEY` 环境变量中配置服务凭据。模型 ID、可取得的服务部署版本和参数必须先冻结；API host 必须与显式允许的服务一致。每个 arm 从相同场景首页开始，使用新的 artifacts 目录。本轮只允许受控 App 内容进入这些模型请求。

新安装 SoloPi 第一次启动可能停在免责声明、权限说明或初始化页面，须完成首次确认及对应副本的辅助功能设置，再运行预检。本轮用户已完成首次初始化，控制端口迁移已收到匹配 requestId 的成功回执；本地 `output/vision-regression/validation/doctor-internal-ready-verified.json` 显示 `com.alipay.hulu.fastpath` 的辅助功能和内部 ADB 均可用，`executionProfiles.host.ready=true`、`replayMode=headless`，doctor 通过。该 host profile 的就绪状态对应本轮电脑控制入口。使用下面命令核对当前包协议与设备状态；若 doctor 未通过，按 [SKILL.md](../SKILL.md) 的门禁与恢复流程处理。

```sh
python3 -m solopi_harness --serial "$VISION_DEVICE_SERIAL" \
  --package "$VISION_HARNESS_PACKAGE" --device-port "$VISION_CONTROL_PORT" doctor
python3 -m solopi_harness --serial "$VISION_DEVICE_SERIAL" \
  --package "$VISION_HARNESS_PACKAGE" --device-port "$VISION_CONTROL_PORT" capabilities
```

```sh
python3 -m solopi_harness --serial "$VISION_DEVICE_SERIAL" \
  --package "$VISION_HARNESS_PACKAGE" --device-port "$VISION_CONTROL_PORT" verify-run \
  --plan ./output/vision-regression-work/controlled-inputs/controlled-icon/normal/plan.json \
  --artifacts ./output/vision-regression-work/rules-round-01 \
  --decision-provider goalpath \
  --goalpath-policy ./output/vision-regression-work/controlled-inputs/controlled-icon/normal/policy.json \
  --goalpath-mode rules --goalpath-visual-input text \
  --goalpath-candidate-pool expanded --segment-screenshots

python3 -m solopi_harness --serial "$VISION_DEVICE_SERIAL" \
  --package "$VISION_HARNESS_PACKAGE" --device-port "$VISION_CONTROL_PORT" verify-run \
  --plan ./output/vision-regression-work/controlled-inputs/controlled-icon/normal/plan.json \
  --artifacts ./output/vision-regression-work/text-round-01 \
  --decision-provider goalpath \
  --goalpath-policy ./output/vision-regression-work/controlled-inputs/controlled-icon/normal/policy.json \
  --goalpath-mode llm --goalpath-visual-input text \
  --goalpath-candidate-pool expanded --segment-screenshots \
  --goalpath-llm-endpoint "$VISION_API_ENDPOINT" --goalpath-llm-model "$VISION_MODEL_ID" \
  --goalpath-api-key-env VISION_API_KEY --goalpath-allowed-host "$VISION_API_HOST" \
  --goalpath-max-output-tokens 2048

python3 -m solopi_harness --serial "$VISION_DEVICE_SERIAL" \
  --package "$VISION_HARNESS_PACKAGE" --device-port "$VISION_CONTROL_PORT" verify-run \
  --plan ./output/vision-regression-work/controlled-inputs/controlled-icon/normal/plan.json \
  --artifacts ./output/vision-regression-work/image-round-01 \
  --decision-provider goalpath \
  --goalpath-policy ./output/vision-regression-work/controlled-inputs/controlled-icon/normal/policy.json \
  --goalpath-mode llm --goalpath-visual-input image \
  --goalpath-candidate-pool expanded --segment-screenshots \
  --goalpath-llm-endpoint "$VISION_API_ENDPOINT" --goalpath-llm-model "$VISION_MODEL_ID" \
  --goalpath-api-key-env VISION_API_KEY --goalpath-allowed-host "$VISION_API_HOST" \
  --goalpath-max-output-tokens 2048
```

以上只是单场景命令，完整 320 轮须遵循冻结清单交错执行。执行器产生的 report、timing、动作回执、决策请求和本轮原始 PNG 共同构成证据；HTML 只引用实际产生的图片。本文不附示意图或占位图作为真实设备截图。

这些命令只运行 SoloPi 主试验。当前模块没有集成或调用 Artemis 执行器；补充试验须使用独立的上游执行器保留证据，再导入相应 arm。离线 VLM API 调用不能写成 Artemis 运行结果。

#### Artemis 补充试验的已核验入口

上游固定 revision 为 `351ca8422f7b5b54e80a9c1ce03a222e02415b6b`，提交时间为 `2026-09-29T00:29:02Z`。该版本的 [CLI 源码](https://github.com/google/artemis/blob/351ca8422f7b5b54e80a9c1ce03a222e02415b6b/artemis/interfaces/cli/commands/run.py#L169) 确认支持 `--profile flash|pro`、`--device-serial`、`--locked-app`、`--explorer-flash-mode`、`--explorer-pro-mode`、`--verification-level` 和 `--standalone`。以下是源码核对后的单轮示例，尚未执行；它们不表示四条支付宝任务已可达或模型已可调用。

先在已忽略的 `output/vision-regression-work/artemis-upstream` 准备该固定提交的 upstream checkout，并独立完成其依赖与凭据配置。`git -C ./output/vision-regression-work/artemis-upstream rev-parse HEAD` 的结果必须与上述 SHA 一致。`ARTEMIS_GOAL` 必须来自冻结的支付宝任务，`VISION_DEVICE_SERIAL` 必须指向本轮指定设备；两轮分别恢复相同初态，使用新的 trace 目录。上游的 [Settings](https://github.com/google/artemis/blob/351ca8422f7b5b54e80a9c1ce03a222e02415b6b/artemis/config/settings.py#L92) 提供 `TRACES_PATH` 环境变量，须确认生效配置没有用其他 `.env` 值覆盖它；checkout、trace、配置摘要和导入账本均保存在 `output/vision-regression-work/` 下。

```sh
ARTEMIS_CHECKOUT="$PWD/output/vision-regression-work/artemis-upstream"
ARTEMIS_FLASH_TRACES="$PWD/output/vision-regression-work/artemis-flash-round-01"
ARTEMIS_PRO_TRACES="$PWD/output/vision-regression-work/artemis-pro-round-01"

(
  cd "$ARTEMIS_CHECKOUT" || exit 1
  TRACES_PATH="$ARTEMIS_FLASH_TRACES" uv run artemis run "$ARTEMIS_GOAL" \
    --standalone --profile flash \
    --device-serial "$VISION_DEVICE_SERIAL" \
    --locked-app com.eg.android.AlipayGphone \
    --explorer-flash-mode flash
)

(
  cd "$ARTEMIS_CHECKOUT" || exit 1
  TRACES_PATH="$ARTEMIS_PRO_TRACES" uv run artemis run "$ARTEMIS_GOAL" \
    --standalone --profile pro \
    --device-serial "$VISION_DEVICE_SERIAL" \
    --locked-app com.eg.android.AlipayGphone \
    --explorer-pro-mode flash --verification-level final
)
```

显式 `--standalone` 是为固定参数的实际生效入口：该版本默认优先通过 daemon 调度，但 [daemon 提交分支](https://github.com/google/artemis/blob/351ca8422f7b5b54e80a9c1ce03a222e02415b6b/artemis/interfaces/cli/commands/run.py#L328) 没有转发 Explorer tier、`verification_level` 和 `traces_path` 等参数；[直接执行分支](https://github.com/google/artemis/blob/351ca8422f7b5b54e80a9c1ce03a222e02415b6b/artemis/interfaces/cli/commands/run.py#L407) 会传入这些配置。两个示例将 Explorer tier 都设为 `flash`，只改变顶层执行 profile；Pro 的 `final` 验证行为也显式记录。Flash/Pro 各自的计划、执行前检查和 Checker 能力仍按上游 profile 区分，不因此成为仅切换一个模型的对照。

凭据和设备设置的准确变量名见上游公开 [.env.example](https://github.com/google/artemis/blob/351ca8422f7b5b54e80a9c1ce03a222e02415b6b/.env.example)：Google provider 接受 `GEMINI_API_KEY` / `GOOGLE_API_KEY`；设备连接使用 `ADB_HOST`、`ADB_PORT`、`ADB_DEVICE_SERIAL`；层级后端和 Helper 安装行为分别由 `ARTEMIS_HIERARCHY_BACKEND`、`ARTEMIS_HELPER_AUTO_INSTALL` 配置。凭据值不写入协议、摘要或 trace 导入文件。协议还须冻结实际使用的层级后端、Helper 版本及 fallback 情况，避免把后端变化误归因于 profile。

模型身份需要完整的多节点配置证据。上游 [`config/artemis.jsonc`](https://github.com/google/artemis/blob/351ca8422f7b5b54e80a9c1ce03a222e02415b6b/config/artemis.jsonc#L7) 用 `default`、`nodes.*`、`agent.flash`、`agent.pro` 分别定义模型与执行能力；该提交的全局默认字符串是 `google / gemini-3.8-flash`，fallback 为 `gemini-3.7-flash`，`object_detector`、`hopper`、Flash step summarizer 和 Pro 轻量 judge 等还有独立模型。**这些源码字符串不构成可调用性、账户权限或真实模型版本的实证**，不能直接填成“已验证可调用”。正式冻结应保存脱敏后的完整生效配置摘要及 SHA256，例如 `output/vision-regression-work/artemis-config-frozen.json`，记录每个节点的 provider、primary/fallback 模型和参数；每轮回执另记录实际命中的节点、模型及 fallback 路由。单个 arm 的 `model.name/version` 不足以独立复现这条调用链。

上述核验仅确认 Android 平台与执行入口。提醒设置、充值页区域、扫码退出、通用设置仍须分别保存 SoloPi、Artemis Flash 和 Artemis Pro 的真实 discovery、初态、终点 Oracle 与清理证据，之后才能将对应 `runnerSupport` 从 `unverified` 改为已支持并冻结 80 轮补充试验。当前尚无这些运行证据，也没有 Artemis 成功率、时延或成本收益结论。

### 3.5 从真实运行收集待标注样本

真实执行结束后，先把 `VISION_RUN_ARTIFACTS` 设置为这一轮的证据目录，再采集。本命令只读本地证据，不操作设备、不请求模型，也不生成正确答案：

```sh
python3 -m solopi_harness.vision_collect \
  --artifacts "$VISION_RUN_ARTIFACTS" \
  --output ./output/vision-regression-work/collection-icon-01 \
  --task-id controlled-icon \
  --source-group-id controlled-icon-base-01 \
  --group-id controlled-icon-base-01 --split dev
```

工具核对同次 report、plan、transcript、观察 ID、候选、请求摘要与原图哈希后，复制原始 PNG 和请求，输出 `bundle.json` 与 `pending-labels.json`。答案初始为 `null`，`evaluationReady=false`；独立核验后才能另建冻结数据集。模型选择、规则选择和运行结果都不会自动变成预期答案。早退、终态图或没有模型请求的情况进入 `exclusions`，不能补造候选凑样本。

同一基础页面的 normal/reversed、重复拍摄和不同候选池均须使用相同 `sourceGroupId`，不能分别放入 dev 与 holdout。现有 9 个受控变体适合作为 dev pilot，不足以形成 180 个独立样本；正式留出集仍需采集更多独立页面。

本轮已从受控 pilot 冻结 8 个 dev 决策上下文，归属 4 个源组，holdout 样本为 0。`wrong-oracle` 的准备页面主体与相似布局 normal 重复，因此 8 个上下文不代表 8 个独立页面；不得通过换任务名或 Oracle 名把重复页面算作独立样本或留出数据。180 样本目标仍未完成。

### 3.6 冻结截图的离线 API 评测

完成真实样本采集并设置 `VISION_DATASET_MANIFEST` 指向冻结 manifest 后，先校验全部样本，再做 dev 试运行：

本轮已对上述 8 个受控 dev 上下文执行四条件评测，32 条请求记录均已结束，包含 2 次接口失败。原始 `summary.json`、`rows.jsonl`、`metadata.json` 与配置协议保存在 `output/vision-regression/offline-dev-eight-contexts-v1/`。使用配置的同一实际 VLM、2048 输出预算、temperature 0，无自动重试，预期答案没有发送给模型。它与 27 条设备 pilot 分别记账，没有手机动作、业务验收或 holdout 结果。

| 离线条件 | 正确 / 全部上下文 | 返回有效选择的请求 | 接口失败 | 错误动作建议 |
|---|---:|---:|---:|---:|
| text-forward | 2/8 | 8/8 | 0 | 6 |
| text-reverse | 2/8 | 6/8 | 2 | 4 |
| vision-forward | 7/8 | 8/8 | 0 | 1 |
| vision-reverse | 5/8 | 8/8 | 0 | 3 |

表中正确数始终保留全部 8 个上下文作为分母，接口失败不剔除；有效返回包含 `abstain`，vision-forward 有一次实际拒答。反序会重新编号候选并映射回原始语义后判分，vision 从 7/8 变为 5/8，说明当前结果仍对候选顺序敏感。8 个 dev 上下文包含 wrong-oracle 与 similar-normal 的页面主体重复，没有独立 holdout，不能据此推导总体识别准确率或业务成功率。设备 pilot 的 no-target 误点与这里的顺序敏感性共同支持继续默认使用 rules，并延后 MCP 与探索路径导出。

```sh
python3 -m solopi_harness.vision_benchmark validate-dataset \
  --manifest "$VISION_DATASET_MANIFEST"

python3 -m solopi_harness.vision_evaluate \
  --manifest "$VISION_DATASET_MANIFEST" \
  --endpoint "$VISION_API_ENDPOINT" --model "$VISION_MODEL_ID" \
  --api-key-env VISION_API_KEY --allowed-host "$VISION_API_HOST" --max-output-tokens 2048 \
  --output ./output/vision-regression-work/offline-dev --split dev --limit 20
```

每个样本固定请求 text-forward、text-reverse、vision-forward、vision-reverse，反序后重新编号并映射回原候选，检测候选位置偏置。截图需为 PNG；请求及预期均有独立冻结文件，预期为 `choice=candidate_N` 或 `abstain`，只由本地判分。所有 split 的引用先校验，选中的 split 再发 API。服务调用不自动重试，每条失败及时写 `rows.jsonl`，并保存 metadata、protocol 和 summary。`--output` 必须为新目录。

配置冻结后，holdout 命令使用同一模型与服务参数，并省略 `--limit`：

```sh
python3 -m solopi_harness.vision_evaluate \
  --manifest "$VISION_DATASET_MANIFEST" \
  --endpoint "$VISION_API_ENDPOINT" --model "$VISION_MODEL_ID" \
  --api-key-env VISION_API_KEY --allowed-host "$VISION_API_HOST" --max-output-tokens 2048 \
  --output ./output/vision-regression-work/offline-holdout --split holdout
```

离线 summary 统计正确选择、拒答、错误动作建议和调用失败；逐条 inference 回执另记录服务返回的用量及推理调用耗时。冻结 request 可保留经校验的真实采集 visual 元数据；没有此元数据时，evaluator 生成 `frozen-request-derived` 的离线标识，不宣称存在实时页面树绑定。离线工具不执行动作、不检查业务完成或清理，因此不能直接作为设备回归逐轮通过记录，也不能证明 10 个百分点任务成功率收益。

### 3.7 调度、逐轮账本与复算

当前可生成的草稿清单命令为：

```sh
python3 -m solopi_harness.vision_benchmark schedule \
  --protocol solopi-skill/scripts/harness/examples/vision-regression/protocol.json \
  --out ./output/vision-regression-work/schedule-draft.json --draft
```

完成实际发现与文件冻结后，设置 `VISION_FROZEN_PROTOCOL` 为正式协议、`VISION_ROUND_ROWS` 为真实逐轮 JSONL，再生成正式调度或复算报告：

```sh
python3 -m solopi_harness.vision_benchmark schedule \
  --protocol "$VISION_FROZEN_PROTOCOL" --out ./output/vision-regression-work/schedule.json

python3 -m solopi_harness.vision_benchmark summarize \
  --protocol "$VISION_FROZEN_PROTOCOL" --rows "$VISION_ROUND_ROWS" \
  --out ./output/vision-regression-work/benchmark-report
```

每轮必须记录 experimentId、taskId、arm、round、协议/arm/runner/模型身份、passed/failed/not_tested、elapsedMs、wrongActions、falsePasses、manualInterventions 和 cold/warm；哨兵另需显式核验与证据。基础设施失败写 not_tested，普通任务失败写 failed，均保留原始记录。dialog/disabled/no-target 等任务级拒答保留原始 not_tested，只有显式 `failureClass=task`、`outcomeObserved=true` 且具有非空独立核验证据时才算已评估；它可以补全账本，但不能改成 passed 或增加通过率分子。基础设施未测、未经核验的拒答、缺轮、重复、身份不符或缺计数/哨兵证据时，摘要仍为 incomplete，收益栏留空。

摘要区分 recorded（所有匹配记录，含重复/无效）、evaluated（唯一有效结果，含核验拒答）、tested（passed+failed）及原始三态计数。所有计划轮次保留分母，困难任务 8/10 只计 passed；八次通过与两次已核验拒答可以构成完整的 8/10，拒答本身不计成功。耗时、成本、用量和错误计数包含所有 evaluated 的失败与拒答。不能删掉失败或拒答后重算。

总体及 cold/warm 分别报告 N、中位数与 nearest-rank P95（ceil(0.95×N)），并保留计划数和未评估数，不推算缺轮耗时。N<20 时 P95 通常为样本最大值，只作描述，不能宣称稳定尾时延。各阶段 inclusive 耗时可重叠，不能相加。输出为可重生成的 `summary.json` 和中文 `summary.md`。

字段、manifest 和公共 Python 接口详见 [评测示例 README](../scripts/harness/examples/vision-regression/README.md)，计划内容见 [草稿协议](../scripts/harness/examples/vision-regression/protocol.json)。

### 3.8 已有自动验证与待补实测

benchmark 提供自动测试，覆盖冻结校验、模型与执行器身份、Artemis 共同流程限制、分组泄漏、缺轮/重复、计数、阈值、安全及报告。其余视觉模块也提供对应测试；下面命令只跑主机侧自动测试，不连接设备或外部 API：

```sh
python3 -m unittest discover -s solopi-skill/scripts/harness/tests -p 'test_*vision*.py' -v
python3 -m unittest discover -s solopi-skill/scripts/harness/tests -p 'test_visual*.py' -v
python3 -m unittest discover -s solopi-skill/scripts/harness/tests -p test_prepare_controlled.py -v
```

自动测试使用 fixture 或模拟响应验证合同，不能列为真实模型调用或收益数据。最新全量 Harness Python 验证通过 **643 个测试，耗时 21.349 秒，结果为 `OK`**，原始日志为 `output/vision-regression/validation/python-tests-final-v5.log`；范围包含已有 native 能力、本轮视觉模块、空闲连接与 dispatch 前证据保留、九份计划的准备等待及精确验收。Android 193 个单元测试及真机 1080×2400 原图解码也已通过。配置的模型服务已完成 5 次合成兼容预检，其中原预算 128 token 的首次请求被截断，其余 4 次 2048 token 请求成功；这些合成预检独立保存。

真机 pilot 已完成：FastPath 与 Demo 均已安装，准确副本的辅助功能、内部 ADB 和 host/headless profile 已核验就绪。早期 v3 的首条完整运行与 v4 的准备页延迟失败均保留；v5 使用统一修订执行全部 27 条，历史版本不与 v5 混算。

### 3.9 v5 受控 pilot 实测与审计（已完成）

批次位于 `output/vision-regression/pilot-internal-v5/`，四组九变体的 rules/text/image 共 **27/27 条已完成并逐项审计，27 条清理均为 passed**。证据摘要、逐条记录与可读表分别为 `audit-new/summary.json`、`audit-new/rows.jsonl`、`audit-new/summary.md`。固定业务 Oracle 按原值复核；错误动作依据 Demo 源码中目标与干扰入口的实际语义及动作回执判定，不用模型回答定义正确答案。

最终 `final-session-audit.json` 逐一核对 27 个 Agent 会话：全部为终态、`active=false`、`leaseHeld=false`，本轮会话与设备租约已释放。结束或取消只反映会话收尾，不改变各轮原始业务状态与错误动作记录。

| arm | 原始 passed | 原始 not_tested | 原始 failed | 四个正向任务通过 | 实际错误动作 | 到达并触发预期 mismatch 的负向 Oracle |
|---|---:|---:|---:|---:|---:|---:|
| rules | 4 | 3 | 2 | 4/4 | 0 | 2/2 |
| text | 1 | 7 | 1 | 1/4 | 5 | 1/2 |
| image | 4 | 3 | 2 | 4/4 | 1 | 2/2 |

这里保留执行器的原始三态。负向 Oracle 的正确表现是实际到达详情后报告 `failed/oracle_mismatch`，不改记为业务 passed；相同的 `not_tested` 也可能对应 guard、实际拒答、接口失败或误点后未到达业务终点，必须结合逐项证据解释。四个正向任务是图标 normal/reversed 与相似布局 normal/reversed，各只执行一轮。

| 场景 | 已审计事实 | 解释边界 |
|---|---|---|
| 无标签图标 normal / reversed | 两个变体的 image 与 rules 均通过独立业务验收和清理 | 强规则在有稳定 ID 时仍有效，两个图像结果不能推导稳定成功率 |
| 无标签图标 normal / text | 2048 输出预算下出现接口失败 | 不是模型主动返回 `abstain`，不能记为正确拒答 |
| 无标签图标 reversed / text | 点击了错误的客服入口 | 需按实际动作回执记录错误选择，保留原始失败 |
| 相似布局 normal | rules/text/image 均通过 | 此页面上 text 已足以完成，不能只用 image 通过宣称图像增益 |
| 相似布局 reversed | rules 与 image 通过；text 选择错误入口 | 属于当前单轮配对差异，仍待多轮验证 |
| 真正 Dialog 遮挡 | text/image 均在前置 guard 阶段阻断，没有模型调用 | 只能证明 guard 生效，不能把没有调用模型记为模型识别遮挡或正确拒答 |
| 目标 disabled | image 实际返回 `abstain`；text 点击错误入口 | image 的实际拒答与前置 guard 阻断必须区分；均不把 `not_tested` 改为业务通过 |
| 无目标 no-target | rules 无错误动作；text 与 image 均实际点击干扰入口 | image 因这一次误点未通过零错误动作门槛，即使最终状态仍为 `not_tested` |
| 错误业务结果 wrong-result | rules/image 到达 `DETAIL`，独立“已支付”Oracle 对真实“已取消”报告 mismatch；text 误点后未到达 | text 此项保持 `not_tested`，不能计为已验证负向 Oracle |
| 错误验收 wrong-oracle | 三个 arm 均实际到达 `DETAIL`，先通过真实“已支付”检查，再由哨兵 Oracle 报 mismatch | 证明这些实际到达样例没有错误放行；不替代其他任务或更多轮次的覆盖 |

rules、text、image 的设备 pilot 分别记录 0、8、8 次模型 API 调用；text/image 的服务上报 total token 分别为 11055、15271。这些计数包含接口失败与拒答，不只统计成功运行；没有实际账单，成本金额不推算。Dialog 没有模型请求，不进入模型识别或拒答能力分母。审计对已到达的负向 Oracle 未发现错误放行，但 image 的 no-target 误点已足以使零错误动作门槛失败。

v5 是受控 dev pilot，各变体各 arm 仅一轮；它不证明统计显著性、真实业务泛化或稳定时延收益。当前默认继续使用 rules，MCP 入口和探索路径标准导出继续延后。正式 240+80 轮尚未执行，180 样本目标与正式 holdout 尚未完成；本轮没有上传支付宝截图或页面内容。

## 四、收益

当前可确认的是评测与取证能力已经落地：能够约束模型只选择当前候选，绑定当前画面，保留独立业务验收，并对冻结账本做可复算的完整性检查。v5 的 27 条受控真机记录已审计；四个正向任务中 image 与 rules 均为 4/4，text 为 1/4，但其中一次 text 未通过是接口输出失败，不能归因于视觉识别能力。image 还在 no-target 场景发生一次实际误点，**零错误动作收益门槛未通过，默认继续使用 rules**。正式多轮账本与独立 holdout 尚未形成，这轮结果不支持稳定准确率、速度或成本收益结论。

内部服务的正式 transport 兼容预检已有以下实际记录，两次使用同一合成图、候选、模型和 2048 输出预算；text 条件只发送语义，image 条件额外发送合成 PNG：

| 条件 | 实际返回 | API 往返 | 输入 / 输出 token |
|---|---|---:|---:|
| text | `abstain` | 3138.127 ms | 527 / 208 |
| image | `candidate_1`，蓝色区域正确 | 1857.179 ms | 495 / 150 |

这是各一次的接口兼容检查，不能据此推导速度提升、真实页面正确率或真机任务成功率。全部五次合成预检还包括首次 128 预算截断，以及两次直接协议兼容探查；总 token 为 3032。没有实际账单，成本金额不推算。原始回执保存在 ignored `output/vision-regression/validation/internal-api-preflight/`，没有混入正式账本。

收益放行按以下标准核验：同模型 image 相对 text 的任务通过率至少提升 10 个百分点；至少两个预先标注的困难任务达到 8/10；候选的安全哨兵完整核验、错误动作和错误放行均为 0；候选全部任务错误放行及人工介入为 0。相对 rules 只报告比较数据，不设额外 10 个百分点门槛。Artemis Flash/Pro 是补充 Agent 模式比较，不能替代同模型图文对照。任何自动 fixture、缺失哨兵或缺失人工介入字段都不能满足真实收益证据资格。

后续针对 no-target 误点、离线候选顺序敏感性与接口输出失败分析原因，再冻结更多独立样本、评估正式多轮与 holdout 的准入条件。MCP 产品入口、探索路径的标准导出与复用继续延后，待收益与零错误动作门槛满足后再决定投入。现有 plan 的固定段 case 导出属于执行输入生成，尚不能说明动态探索路径已经成为可稳定复用的产品能力。
