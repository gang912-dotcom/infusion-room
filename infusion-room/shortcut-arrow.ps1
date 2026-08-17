# 바로가기 아이콘 좌하단의 화살표를 감추거나 되돌린다. PC마다 한 번만 돌리면 된다.
#
# 화살표는 우리 아이콘의 일부가 아니라 윈도가 그 위에 겹쳐 그리는 표시다. 그래서
# 아이콘 파일을 아무리 고쳐도 안 없어진다. 없애려면 '화살표로 쓸 그림'을 바꾸는
# 수밖에 없고, 그 설정은 레지스트리 한 곳에 있다.
#
#   HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons  의 값 29
#
# 여기에 아무것도 안 그려진 아이콘(blank.ico)을 물리면 화살표가 사라진다.
#
# 알아두실 것 세 가지
#  - 이 PC의 **모든** 바로가기에 적용된다. 수액실 것만 골라서는 안 된다.
#  - 시스템 설정이라 관리자 권한이 필요하다(이 스크립트가 알아서 물어본다).
#  - 적용하면 탐색기를 다시 시작한다. 열어 둔 폴더 창이 닫히니 작업 중이면 저장부터.
#
# 쓰는 법: hide-shortcut-arrow.bat  (감추기) / restore-shortcut-arrow.bat (되돌리기)

param([switch]$Restore, [switch]$Quiet)

$Url      = 'http://192.168.0.86:4000'
$IconDir  = Join-Path $env:LOCALAPPDATA 'infusion-room'
$Blank    = Join-Path $IconDir 'blank.ico'
$RegPath  = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons'

# ── 이미 그 상태면 아무것도 안 한다 ─────────────────────────────────────
# setup-pc-app 이 매번 이걸 부르므로, 이미 적용된 PC 에서 탐색기를 또 다시 시작하면
# 열어 둔 창만 애꿎게 닫힌다. 값이 있고 그 파일이 실제로 있으면 끝난 것으로 본다.
$current = (Get-ItemProperty -Path $RegPath -Name '29' -ErrorAction SilentlyContinue).'29'
$applied = $current -and (Test-Path ($current -replace ',0$',''))
if ((-not $Restore) -and $applied) {
  if (-not $Quiet) { Write-Host '이미 적용돼 있습니다. 그대로 둡니다.' -ForegroundColor Green; Read-Host '엔터를 누르면 닫힙니다' }
  exit 0
}
if ($Restore -and -not $current) {
  if (-not $Quiet) { Write-Host '이미 윈도 기본값입니다.' -ForegroundColor Green; Read-Host '엔터를 누르면 닫힙니다' }
  exit 0
}

# ── 관리자 권한으로 올라가기 ────────────────────────────────────────────
# HKLM 은 관리자만 쓸 수 있다. 권한이 없으면 자기 자신을 관리자로 다시 띄운다.
#
# 바로가기 만들기(setup-pc-app.ps1)를 여기에 합치지 않는 이유가 이것이다 — 관리자로
# 올라가면 다른 계정으로 도는 수가 있고, 그러면 바탕화면 경로가 그 계정 것이 되어
# 바로가기가 엉뚱한 자리에 생긴다. 바로가기는 원래 계정에서 만들고, 권한이 필요한
# 이 부분만 따로 올라간다.
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host '관리자 권한이 필요합니다. 창이 하나 더 뜨면 [예]를 눌러 주세요.' -ForegroundColor Yellow
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Restore) { $args += '-Restore' }
  if ($Quiet)   { $args += '-Quiet' }
  Start-Process powershell -Verb RunAs -ArgumentList $args
  exit
}

Write-Host ''
if ($Restore) {
  Write-Host '=== 바로가기 화살표 되돌리기 ===' -ForegroundColor Cyan
  if (Test-Path $RegPath) {
    Remove-ItemProperty -Path $RegPath -Name '29' -ErrorAction SilentlyContinue
  }
  Write-Host '윈도 기본값으로 되돌렸습니다.'
} else {
  Write-Host '=== 바로가기 화살표 감추기 ===' -ForegroundColor Cyan
  Write-Host '이 PC의 모든 바로가기에 적용됩니다.' -ForegroundColor Yellow

  # 빈 아이콘 받기. 서버에서 받는 이유는 app-icon.ico 와 같은 길을 쓰기 위해서다.
  New-Item -ItemType Directory -Force -Path $IconDir | Out-Null
  try {
    Invoke-WebRequest -Uri "$Url/blank.ico" -OutFile $Blank -UseBasicParsing -TimeoutSec 10
  } catch {
    Write-Host '빈 아이콘을 못 받았습니다 (서버가 꺼져 있거나 주소가 다름).' -ForegroundColor Red
    Write-Host '아무것도 바꾸지 않았습니다.'
    if (-not $Quiet) { Read-Host '엔터를 누르면 닫힙니다' }
    exit 1
  }
  if (-not (Test-Path $Blank) -or (Get-Item $Blank).Length -eq 0) {
    Write-Host '받은 파일이 비어 있습니다. 아무것도 바꾸지 않았습니다.' -ForegroundColor Red
    if (-not $Quiet) { Read-Host '엔터를 누르면 닫힙니다' }
    exit 1
  }

  if (-not (Test-Path $RegPath)) { New-Item -Path $RegPath -Force | Out-Null }
  New-ItemProperty -Path $RegPath -Name '29' -Value "$Blank,0" -PropertyType String -Force | Out-Null
  Write-Host "빈 아이콘: $Blank"
}

# ── 반영 ────────────────────────────────────────────────────────────────
# 아이콘 캐시를 비우고 탐색기를 다시 시작해야 화면에 반영된다.
Write-Host '탐색기를 다시 시작합니다...'
Start-Process 'ie4uinit.exe' -ArgumentList '-show' -WindowStyle Hidden -ErrorAction SilentlyContinue
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) { Start-Process explorer }

Write-Host ''
Write-Host '끝났습니다.' -ForegroundColor Green
if (-not $Restore) {
  Write-Host '되돌리려면 restore-shortcut-arrow.bat 을 실행하세요.'
}
if (-not $Quiet) { Read-Host '엔터를 누르면 닫힙니다' }
