# =============================================================================
# push.ps1 —— 一鍵建置、驗證、推送 GitHub Pages
#
# 用法（在專案根目錄）：
#   pwsh -File .\push.ps1
#   pwsh -File .\push.ps1 -Message "feat: 新增第1段第2次名句"
#   pwsh -File .\push.ps1 -NoTest          # 跳過 node 測試（不建議）
#
# 流程：
#   1. 重建題庫（source/ + data/source/）
#   2. 驗證資料（0 error 才繼續）
#   3. 跑邏輯測試（node tools/test_core.mjs）
#   4. 若有變更：自動 bump sw.js 的 VERSION（強制瀏覽器更新快取）
#   5. git add → commit → push
#   6. 等 GitHub Pages 建置完成，印出網址
# =============================================================================

[CmdletBinding()]
param(
  [string]$Message = "",
  [switch]$NoTest
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# 中文輸出（Windows PowerShell 5.1 / pwsh 都適用）
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $OutputEncoding = [Console]::OutputEncoding
} catch { }

function Write-Step($text) {
  Write-Host ""
  Write-Host "== $text" -ForegroundColor Cyan
}
function Fail($text) {
  Write-Host ""
  Write-Host "✗ $text" -ForegroundColor Red
  exit 1
}
function Find-Python {
  $candidates = @()
  if ($env:PYTHON) { $candidates += $env:PYTHON }
  $candidates += "C:\Users\Hunggy\AppData\Local\Programs\Python\Python314\python.exe"
  foreach ($name in @("python", "py")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
  }
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return $null
}

# --- 0. 基本檢查 -------------------------------------------------------------
if (-not (Test-Path (Join-Path $root ".git"))) { Fail "這裡不是 git repo：$root" }
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { Fail "找不到 git，請先安裝 Git。" }

$python = Find-Python
if (-not $python) { Fail "找不到 Python。請設定環境變數 PYTHON 或安裝 Python 3。" }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $NoTest -and -not $node) { Fail "找不到 node；如要跳過測試，加 -NoTest。" }

Write-Host "專案：$root" -ForegroundColor DarkGray
Write-Host "Python：$python" -ForegroundColor DarkGray

# --- 1. 建置題庫 -------------------------------------------------------------
Write-Step "1/5 建置題庫（tools/build_dataset.py）"
& $python "tools/build_dataset.py"
if ($LASTEXITCODE -ne 0) { Fail "題庫建置失敗（exit $LASTEXITCODE）。" }

# --- 2. 驗證資料 -------------------------------------------------------------
Write-Step "2/5 驗證資料（tools/validate_data.py）"
& $python "tools/validate_data.py"
if ($LASTEXITCODE -ne 0) { Fail "資料驗證失敗；請看上面的 error。" }

# --- 3. 邏輯測試 -------------------------------------------------------------
if ($NoTest) {
  Write-Step "3/5 已跳過邏輯測試（-NoTest）"
} else {
  Write-Step "3/5 邏輯測試（tools/test_core.mjs）"
  & $node "tools/test_core.mjs"
  if ($LASTEXITCODE -ne 0) { Fail "邏輯測試失敗；修正後再推。" }
}

# --- 4. 檢查有無變更，必要時 bump SW 版本 ------------------------------------
Write-Step "4/5 檢查變更"
& $git add -A
$staged = & $git diff --cached --name-only
if (-not $staged) {
  Write-Host "沒有需要推送的變更。" -ForegroundColor Yellow
  exit 0
}

$swPath = Join-Path $root "sw.js"
if (Test-Path $swPath) {
  $sw = Get-Content $swPath -Raw
  $today = Get-Date -Format "yyyy-MM-dd"
  $m = [regex]::Match($sw, "cn-review-(\d{4}-\d{2}-\d{2})\.(\d+)")
  if ($m.Success) {
    if ($m.Groups[1].Value -eq $today) {
      $next = [int]$m.Groups[2].Value + 1
    } else {
      $next = 1
    }
    $oldVer = $m.Value
    $newVer = "cn-review-$today.$next"
    $sw = $sw.Replace($oldVer, $newVer)
    # 用 UTF-8 無 BOM 寫回，避免 PowerShell 5.1 加 BOM
    [System.IO.File]::WriteAllText($swPath, $sw, (New-Object System.Text.UTF8Encoding($false)))
    & $git add "sw.js"
    Write-Host "Service Worker 版本：$oldVer → $newVer" -ForegroundColor DarkGray
  } else {
    Write-Host "警告：sw.js 找不到 VERSION 格式，未 bump。" -ForegroundColor Yellow
  }
}

# --- 5. commit + push --------------------------------------------------------
Write-Step "5/5 commit + push"
if (-not $Message) {
  $Message = "update: 題庫與網站 " + (Get-Date -Format "yyyy-MM-dd HH:mm")
}
& $git -c user.name="Hunggy" -c user.email="hunggy@users.noreply.github.com" commit -m $Message
if ($LASTEXITCODE -ne 0) { Fail "git commit 失敗。" }

& $git push origin main
if ($LASTEXITCODE -ne 0) { Fail "git push 失敗（請檢查網絡／GitHub 登入）。" }

Write-Host ""
Write-Host "✓ 已推送到 GitHub。" -ForegroundColor Green

# --- 6. 等 Pages 建置（可選） ------------------------------------------------
$gh = Get-Command gh -ErrorAction SilentlyContinue
$remote = (& $git remote get-url origin) 2>$null
if ($gh -and $remote -match "github\.com[:/]([^/]+)/([^/\.]+)") {
  $owner = $Matches[1]
  $repo = $Matches[2]
  $slug = "$owner/$repo"
  $url = "https://$($owner.ToLower()).github.io/$repo/"

  Write-Step "等 GitHub Pages 建置（最多 90 秒）"
  $ok = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 3
    try {
      $build = & $gh api "repos/$slug/pages/builds/latest" | ConvertFrom-Json
      if ($build.status -eq "built") {
        $ok = $true
        break
      }
      Write-Host ("  … {0}（{1}）" -f $build.status, $build.commit.Substring(0, 7)) -ForegroundColor DarkGray
    } catch {
      Write-Host "  … 等待 Pages 回應" -ForegroundColor DarkGray
    }
  }
  if ($ok) {
    Write-Host "✓ 已上線：$url" -ForegroundColor Green
  } else {
    Write-Host "Pages 仍在建置，稍等一兩分鐘再開：$url" -ForegroundColor Yellow
  }
} else {
  Write-Host "（找不到 gh 或 remote，略過 Pages 狀態檢查）" -ForegroundColor DarkGray
}
