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
$IconDir = Join-Path $env:LOCALAPPDATA 'infusion-room'

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
#
# 파일 이름에 내용 지문(해시 8자리)을 붙인다. 예전에는 늘 같은 이름(app-icon.ico)에
# 덮어썼는데, 윈도는 바로가기 아이콘을 '경로' 기준으로 캐시해서 내용만 바뀌면
# 옛 그림이 계속 떴다. 실제로 아이콘을 바꾸고도 바탕화면이 안 바뀌었다.
# 이름이 달라지면 캐시에 없는 경로라 그 자리에서 새 그림이 나온다.
# 같은 아이콘을 다시 받으면 이름도 같아서 파일이 쌓이지도 않는다.
New-Item -ItemType Directory -Force -Path $IconDir | Out-Null
$haveIcon = $false
$IconPath = $null
try {
  $tmp = Join-Path $IconDir 'app-icon.download'
  # 주소 뒤에 시각을 붙여 받는다. 안 붙이면 PC에 남은 옛 응답이 그대로 와서,
  # 서버 아이콘을 바꿔도 받는 파일이 안 바뀌는 일이 생긴다.
  $bust = [DateTime]::UtcNow.Ticks
  Invoke-WebRequest -Uri "$Url/app-icon.ico?v=$bust" -OutFile $tmp -UseBasicParsing -TimeoutSec 10
  if ((Test-Path $tmp) -and ((Get-Item $tmp).Length -gt 0)) {
    $hash = (Get-FileHash -Path $tmp -Algorithm SHA1).Hash.Substring(0, 8).ToLower()
    $IconPath = Join-Path $IconDir "app-icon-$hash.ico"
    Move-Item -Path $tmp -Destination $IconPath -Force
    $haveIcon = $true
    # 지난 판 아이콘은 치운다. 지금 쓰는 것과 .download 찌꺼기는 남긴다.
    Get-ChildItem -Path $IconDir -Filter 'app-icon*.ico' -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -ne $IconPath } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
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

# 이름을 바꿔도 탐색기가 옛 그림을 들고 있는 경우가 있다. 아이콘 캐시를 한 번 흔들어 준다.
# 없거나 실패해도 상관없다 — 바로가기는 이미 만들어졌다.
try { Start-Process -FilePath 'ie4uinit.exe' -ArgumentList '-show' -WindowStyle Hidden -ErrorAction Stop } catch {}

# ── 4. 바로가기 화살표 감추기 ───────────────────────────────────────────
# 아이콘 좌하단의 화살표는 윈도가 겹쳐 그리는 표시라 아이콘 파일로는 못 없앤다.
# 여기서 같이 처리한다. 그쪽 스크립트가 알아서 관리자 권한을 물어보고(레지스트리를
# 건드려야 한다), 이미 적용된 PC 에서는 아무것도 안 하고 넘어간다.
#
# 바로가기를 다 만든 **뒤에** 부르는 것이 중요하다. 관리자로 올라가면 다른 계정으로
# 도는 수가 있는데, 그 전에 올라가 버리면 바탕화면 경로가 그 계정 것이 되어
# 바로가기가 엉뚱한 자리에 생긴다.
$arrow = Join-Path $PSScriptRoot 'shortcut-arrow.ps1'
if (Test-Path $arrow) {
  Write-Host ''
  Write-Host '바로가기 화살표를 감춥니다(권한 창이 뜨면 [예]).' -ForegroundColor Yellow
  try { & $arrow -Quiet } catch { Write-Host '화살표는 못 감췄습니다. 바로가기는 정상입니다.' -ForegroundColor Yellow }
}

Write-Host ''
Write-Host "만들었습니다: $lnk" -ForegroundColor Green
Write-Host ''
Write-Host '남은 한 가지 — 작업표시줄 고정은 손으로 해야 합니다.' -ForegroundColor Yellow
Write-Host '(윈도10부터 스크립트로 고정하는 길이 막혀 있습니다)'
Write-Host '바탕화면의 아이콘을 작업표시줄로 끌어다 놓으세요.'
Write-Host ''
