# 근무 PC에 '수액실 관리' 앱 바로가기를 만든다. PC마다 한 번만 돌리면 된다.
#
# 왜 바로가기인가: 크롬의 정식 '설치' 버튼은 HTTPS에서만 뜬다. 원내 서버는 http라서
# 안 뜬다. --app= 로 띄우면 주소창·탭 없는 독립 창이 되어 결과는 같다.
#
# 서버 주소가 바뀌면 아래 $Url 한 줄만 고치고 다시 돌리면 된다.

$Url  = 'http://192.168.0.86:4000'
$Name = '수액실 관리'

# 아이콘은 바로가기가 계속 참조하므로 지워지지 않을 곳에 둔다.
# C:\iv-app은 서버 PC에만 있어서 못 쓴다. 사용자 폴더는 항상 쓰기가 되고 안 지워진다.
$IconDir  = Join-Path $env:LOCALAPPDATA 'infusion-room'
$IconPath = Join-Path $IconDir 'app-icon.ico'

Write-Host ''
Write-Host "=== $Name 앱 바로가기 만들기 ===" -ForegroundColor Cyan
Write-Host "서버: $Url"
Write-Host ''

# ── 1. 브라우저 찾기 ────────────────────────────────────────────────
# 크롬이 설치 위치가 여러 군데다(전체 설치/사용자 설치). 없으면 엣지로 떨어진다 —
# 윈도에는 엣지가 항상 있어서 '브라우저가 없어 실패'는 안 난다.
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) {
  Write-Host '크롬도 엣지도 못 찾았습니다.' -ForegroundColor Red
  Write-Host '크롬을 설치한 뒤 다시 실행하세요.'
  exit 1
}
Write-Host ("브라우저: {0}" -f (Split-Path $browser -Leaf))

# ── 2. 아이콘 받기 ──────────────────────────────────────────────────
# 실패해도 계속 간다 — 아이콘이 없다고 바로가기를 못 만들 이유는 없다.
New-Item -ItemType Directory -Force -Path $IconDir | Out-Null
$haveIcon = $false
try {
  Invoke-WebRequest -Uri "$Url/app-icon.ico" -OutFile $IconPath -UseBasicParsing -TimeoutSec 10
  $haveIcon = (Test-Path $IconPath) -and ((Get-Item $IconPath).Length -gt 0)
} catch {
  Write-Host '아이콘을 못 받았습니다 (서버가 꺼져 있거나 주소가 다름).' -ForegroundColor Yellow
  Write-Host '바로가기는 그대로 만듭니다 — 아이콘만 크롬 기본으로 뜹니다.'
}
if ($haveIcon) { Write-Host "아이콘: $IconPath" }

# ── 3. 바로가기 만들기 ──────────────────────────────────────────────
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop "$Name.lnk"
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath   = $browser
$sc.Arguments    = "--app=$Url"
$sc.Description  = $Name
$sc.WorkingDirectory = Split-Path $browser
if ($haveIcon) { $sc.IconLocation = "$IconPath,0" }
$sc.Save()

Write-Host ''
Write-Host "만들었습니다: $lnk" -ForegroundColor Green
Write-Host ''
Write-Host '남은 한 가지 — 작업표시줄 고정은 손으로 해야 합니다.' -ForegroundColor Yellow
Write-Host '(윈도10부터 스크립트로 고정하는 길이 막혀 있습니다)'
Write-Host '바탕화면의 아이콘을 작업표시줄로 끌어다 놓으세요.'
Write-Host ''
