# art-pipeline · 江湖夜雨 AI 美术生成流水线

离线工具链，**非运行时模块**。本目录（`tools/art/`）不被 `index.html` / `src/**` 引用；
生成后的成品由 `env-bootstrap` 从 `MANIFEST.json` 取 `status=ok` 项转 WebP 接入
`assets/generated/`。运行时零依赖、零联网、不加载模型。

## 1. 目录

```
tools/art/
  prompts/<id>.md        17 项资产提示词（正/负提示词、尺寸、步数、seed、snapshot）
  scripts/generate.py    读提示词 → QwenImage21Pipeline → out/*.png → 更新 MANIFEST.json
  scripts/verify.py      校验存在/尺寸/可解码，回填 status/reason
  scripts/analyze_icon.py 图标客观检查（尺寸/极值/标准差/非背景占比/中心结构，只读）
  out/*.png              原始出图（游戏不直接引用）
  MANIFEST.json          生成记录唯一真源
  requirements.txt       非 torch 依赖清单（torch 见 §2）
```

## 2. 一次性安装（离线生成前执行一次）

> 模型只从本机 HF 缓存读取；安装依赖阶段需要网络，之后全部离线。

```powershell
# 1) 项目内独立虚拟环境（不污染系统 Python）
python -m venv tools/art/venv

# 2) PyTorch（RTX 4090 / CUDA 12.4，锁定版本，避免解析到不确定的最新版）
tools/art/venv/Scripts/pip.exe install --only-binary=:all: torch==2.6.0 `
  --index-url https://download.pytorch.org/whl/cu124 --no-cache-dir

# 3) 其余依赖
tools/art/venv/Scripts/pip.exe install -r tools/art/requirements.txt
```

也可由操作者直接运行 `tools/art/scripts/install_deps.ps1`（上述三步 + 生成 + 校验）。

模型缓存事实（本机已核实）：

- 路径：`C:\Users\51054\.cache\huggingface\hub\models--Qwen--Qwen-Image-2.1`
- snapshot：`d26bb61231c349cf6b7896fa83353113880e1ba3`（缓存约 33.1 GB）
- `model_index.json`：`_class_name = QwenImage21Pipeline`，`_diffusers_version = 0.37.0.dev0`；
  text_encoder 为 `Qwen3VLForConditionalGeneration`。
- 因此 diffusers / transformers 必须是支持 `QwenImage21Pipeline` 与 Qwen3-VL 的版本；
  若 PyPI 稳定版缺少该 pipeline，需安装与 `0.37.0.dev0` 对应的 diffusers 构建（只影响离线工具链，不影响运行时）。

硬件：RTX 4090 24 GB；Python 3.12.10。24 GB 无法容纳全部组件，脚本固定使用
`enable_model_cpu_offload()` + `torch.float16`，逐张生成（单图分钟级）。

## 3. 离线开关

`generate.py` 默认：

- `HF_HUB_OFFLINE=1`（未显式设置时由脚本设置）
- `local_files_only=True`
- 优先直接使用本地 snapshot 目录，找不到才回退 repo id + `revision=<snapshot>`

不会在生成阶段联网拉取模型。

## 4. 运行

```powershell
# 只校验提示词、打印生成计划（不加载模型、不写盘）
tools/art/venv/Scripts/python.exe tools/art/scripts/generate.py --dry-run

# 全量生成（逐张写 out/*.png，每张后更新 MANIFEST.json）
tools/art/venv/Scripts/python.exe tools/art/scripts/generate.py

# 只重生成指定资产
tools/art/venv/Scripts/python.exe tools/art/scripts/generate.py --only player drop-xp

# 校验并回填 status/reason（存在 failed 时 --strict 返回退出码 2）
tools/art/venv/Scripts/python.exe tools/art/scripts/verify.py --strict
```

`generate.py` 失败时**不会**写占位图片冒充成功：该资产保留 `status=failed` 与原因，
已有的占位素材由 `env-bootstrap` 在运行时继续使用（架构 §6.4）。

## 5. MANIFEST 结构

```json
{
  "model": "Qwen/Qwen-Image-2.1",
  "snapshot": "d26bb61231c349cf6b7896fa83353113880e1ba3",
  "generatedAt": "2026-10-31T00:00:00Z",
  "assets": [
    {
      "id": "player",
      "file": "out/player.png",
      "promptFile": "prompts/player.md",
      "seed": 2026103102,
      "status": "ok",
      "reason": "",
      "ms": 12345
    }
  ]
}
```

- `status` 只有 `ok` / `failed`；`failed` 必须带可核对原因。
- 同 prompt + seed 可复现（seed 固定写在提示词与 manifest 中）。
- `verify.py` 会以实际文件为准回填；`ok` 但文件缺失/尺寸不符/不可解码会被改回 `failed`。

## 6. 当前环境状态（2026-10-31 12:30 更新，如实记录）

- 已核实：Python 3.12.10、RTX 4090 24 GB、HF 缓存 snapshot `d26bb612…` 完整存在。
- 已安装（项目内 venv `tools/art/venv`）：torch 2.6.0+cu124、torchvision 0.21.0+cu124、
  diffusers 0.42.1、transformers 5.22.1、accelerate、pillow。
- 生成结果：17 项全部 `status=ok`，`verify.py --strict` 通过（`ok=17 failed=0`，退出码 0）；
  `out/*.png` 均为真实出图，同 prompt + seed 可复现。
- 尺寸与渲染：Qwen 的 VAE 要求宽高约为 32 的倍数，直接请求 48×48 会被管线改成 32×32。
  因此 48×48 图标在提示词前置字段用 `renderWidth: 96 / renderHeight: 96` 大图渲染，
  再由 `generate.py` 用 LANCZOS 缩回声明的 `width/height`，成品严格 48×48。
  （其余 15 项尺寸本身满足约束，未使用该字段。）
- 掉落物返工（2026-10-31）：`drop-potion` / `drop-silver` 原先为无主体低对比噪声图，
  已改为“单一大主体 + 纯黑背景 + 粗勾边 + 高对比”图标口径（steps=44，
  seed 2026103201 / 2026103202），并用 `scripts/analyze_icon.py` 做客观检查。
- 安装依赖阶段需要网络；生成阶段离线（`HF_HUB_OFFLINE=1` + `local_files_only=True`）。

## 7. 风格口径

统一正向词：`中国武侠，水墨写意，国风，低饱和，无文字，无水印`；
负向必含：`文字, 水印, 现代物品, 卡牌, 牌面`，并抑制卡槽/牌堆/英文/数字等卡牌与文字观感。
