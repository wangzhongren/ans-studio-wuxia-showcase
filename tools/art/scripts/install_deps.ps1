# art-pipeline 一次性安装 + 生成（需操作者人工执行一次）
# 用途：在项目内 venv 安装 torch(cu124)/diffusers/transformers/accelerate/pillow，
#       随后离线生成 14 项资产并校验。
# 说明：依赖安装需要联网；生成阶段由脚本设置 HF_HUB_OFFLINE=1，不再联网。

$ErrorActionPreference = "Stop"
$Art = Split-Path -Parent $PSScriptRoot   # tools/art
$Venv = Join-Path $Art "venv"
$Py = Join-Path $Venv "Scripts/python.exe"
$Pip = Join-Path $Venv "Scripts/pip.exe"

if (-not (Test-Path $Py)) {
    python -m venv $Venv
}

& $Pip install --only-binary=:all: torch==2.6.0 `
    --index-url https://download.pytorch.org/whl/cu124 --no-cache-dir
& $Pip install -r (Join-Path $Art "requirements.txt")

& $Py (Join-Path $Art "scripts/generate.py")
& $Py (Join-Path $Art "scripts/verify.py") --strict
