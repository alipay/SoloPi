# 图像候选排序基线

`visual_choice.py` 使用官方 SigLIP2 对“一个中文目标与一组候选图片”计算图文匹配分数。它是独立的离线实验脚本，不训练新模型、不连接手机，也不替代 SoloPi 的执行与验收。用于支付宝等真实 App 的图标时，需要先从真实截图中裁剪合法候选，再实测是否具有区分能力；自然图像匹配能力不能直接当作 UI 操作能力。

## 环境与模型

Python 3.12；锁定依赖的环境为 macOS arm64。默认优先使用 PyTorch MPS，也可以传 `--device cpu`。本例全部权重为 float32：375,187,970 个参数，约 1.50 GB 权重；推理还需要额外内存。

```bash
cd /path/to/SoloPi
export VISUAL_WORK="$(mktemp -d "${TMPDIR:-/tmp}/solopi-visual.XXXXXX")"
python3.12 -m venv "$VISUAL_WORK/venv"
"$VISUAL_WORK/venv/bin/python" -m pip install \
  -r solopi-skill/scripts/harness/examples/fastpath/requirements-visual-lock.txt
"$VISUAL_WORK/venv/bin/hf" download google/siglip2-base-patch16-224 \
  --revision 75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2 \
  --local-dir "$VISUAL_WORK/model"
```

模型下载是单独的准备步骤。脚本只读取显式本地目录，使用 `local_files_only=True`、`trust_remote_code=False`、`use_safetensors=True`；加载前核对 7 个模型文件的 SHA-256，不接受修改过的配置、分词器或权重。权重摘要为 `612923381c76ec5a9bed335d1c48827e3f2e506ac31b044b63b2031fadee6a0b`。

## 运行

准备一个只包含本次实验素材的目录，例如 `/path/to/crops`，放入从同一页面截取的 `a.png`、`b.png`。候选 ID 只负责映射回真实节点，不应携带答案标签。首次实验不设置拒答阈值，先观察分数和错误。

```bash
"$VISUAL_WORK/venv/bin/python" solopi-skill/scripts/harness/examples/fastpath/visual_choice.py \
  --model "$VISUAL_WORK/model" \
  --images-root /path/to/crops \
  --candidate a=a.png --candidate b=b.png \
  --query '用于扫描二维码的图标' \
  --output "$VISUAL_WORK/ranking.json"
```

每次必须指定新的输出文件。候选数量为 1～8；只接受根目录内的 PNG、JPEG、WebP 单帧图片。每张图片最多 16 MiB、1600 万像素，合计最多 4800 万像素，边长最多 8192。目标最多 256 字符，模型实际分词后最多 64 token，超限明确拒绝，不静默截断。

输出包括排序、每个候选的原始 logit 与 `matchingScore`、`selectedId`、图片摘要、模型文件摘要、依赖版本，以及模型加载、预处理和推理耗时。`matchingScore` 是 logit 的 sigmoid，**不是正确率**。默认 `status=proposed` 表示提出最高分候选，不能据此直接执行或判定测试通过。

## 拒答与无匹配实验

`--min-score` 和 `--min-margin` 必须成对提供，分别约束最高匹配分数和前两名分数差。它们只是人工策略，没有经过校准；单个候选无法验证前两名分差，开启门槛时也会拒答。只有在独立标注集上确定门槛后，才能讨论适用范围。

`--expected-id` 只用于推理后的评测。传候选 ID 表示预期选中它；传 `none` 表示所有候选都不匹配。它从不传给模型，也不会改变选择。给定否定目标，例如“不是付款码的图标”，不代表模型能可靠理解否定；必须与无匹配样本一起记录实际结果。

```bash
"$VISUAL_WORK/venv/bin/python" solopi-skill/scripts/harness/examples/fastpath/visual_choice.py \
  --model "$VISUAL_WORK/model" \
  --images-root /path/to/crops \
  --candidate a=a.png --candidate b=b.png \
  --query '一只紫色大象' --expected-id none \
  --output "$VISUAL_WORK/no-match.json"
```

无门槛时，模型即使面对无匹配页面也会选最高分候选。该实验正是用来暴露这种错误，不能删掉失败样本后再声称具备拒答能力。

## 验证与局限

2026 年 9 月 29 日已完成固定版本模型下载与文件校验，并在 Apple MPS 上使用真实支付宝截图推理。两张页面分别有 25、26 个统一规则产生的候选：10 次正例查询选对 8 次，6 次无目标查询中有 1 次错误通过门槛，加上正例误选，共有 3 次错误提议通过门槛。热选择中位数为 414.46 ms，不含页面采集与模型加载。

两次人工预审的关闭动作中，白色活动弹窗关闭成功；黄色提示卡片定位正确、动作回执成功，但卡片仍在，未完成目标。配置好的页面树规则与旧图片模板组合覆盖 10/10 次正例。因此本轮仅证明部分外观语义可复用，尚未证明整体回归收益。完整对照与截图见仓库 `docs/harness/fastpath/VISUAL-VALIDATION.md`，分享包内对应文件为 `VISUAL-VALIDATION.md`。

上述评测用外部实验脚本将全部候选按最多 8 张分批处理，合并原始独立匹配分数；本页命令行入口仍限制为 1～8 张。不能只保留正确按钮来复现多候选结果。依赖导入、MPS 检查与此前 14 项本地契约测试通过，仅说明接口条件满足；真实语义结果以上述实验为准。

```bash
"$VISUAL_WORK/venv/bin/python" -m unittest discover \
  -s solopi-skill/scripts/harness/tests -p test_visual_choice.py -v
```

这些测试验证候选映射、路径限制、图片类型与尺寸、输出不覆盖、模型文件校验、文本长度以及门槛语义；测试通过不证明语义选择正确。脚本不包含页面身份校验、节点绑定、执行回执或独立业务断言。只有主流程把裁剪图片绑定到同一帧真实节点、执行前重新校验，并保留固定验收标准后，才能进入真机闭环。

官方资料：[模型与文件](https://huggingface.co/google/siglip2-base-patch16-224/tree/75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2)、[Transformers API](https://huggingface.co/docs/transformers/model_doc/siglip2)。
