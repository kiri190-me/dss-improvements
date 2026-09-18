#Requires -Version 5.1
<#
.SYNOPSIS
    DSS 개선요청 작업 시작 — 개선요청(3500)과 로그인 포털(3100)을 함께 편다.

.DESCRIPTION
    dss-home의 start-home-work.ps1, 계측기의 start-meters-work.ps1과 같은 철학이다.
    엔진 → 설정 → DB → 주소 → 저장소 순으로 하나씩 확인하며 올라간 뒤 서버를 띄운다.
    서버부터 띄우면 DB가 아직 없어 화면이 에러로 뜨고, 사람은 그게 코드 문제인지
    DB 문제인지 구분하지 못한 채 디버깅을 시작한다.

    ── 포털은 곁들이는 것이 아니라 필수다 ──────────────────────────────────
    회사 홈페이지는 포털이 꺼져 있어도 손님이 보는 화면은 멀쩡하다 — [사내 시스템]
    버튼만 죽는다. **개선요청은 다르다. 자체 로그인 화면이 아예 없다.**
    3500을 열면 곧바로 포털로 넘어가는데, 포털이 없으면 그 자리에서 멈춘다.
    글 한 줄 읽는 것도 못 한다. 그래서 이 스크립트는 포털을 띄우는 데서 그치지
    않고 **3100이 실제로 응답할 때까지 기다렸다가**, 끝내 안 뜨면 그 사실을
    분명히 알린 뒤에 개선요청 서버를 띄운다.

    등록도 함께 봐야 한다. 포털은 모르는 client_id의 요청을 거절하므로, 포털이
    떠 있어도 이 사이트가 등록돼 있지 않으면 로그인이 되지 않는다. 등록은 사람이
    한다 — 절차는 README의 「포털에 등록하기」에 있다.

    창이 셋으로 나뉜다. 한 창에 다 넣으면 두 서버의 로그가 뒤섞인다.

      이 창              개선요청 개발 서버 (3500)
      두 번째 창          로그인 포털 (3100)
      세 번째 창          Claude Code — 개선요청

    ── DB를 docker compose로 직접 띄우지 않는 이유 ─────────────────────────
    compose는 .env만 자동으로 읽고 .env.local은 읽지 않는다. 그냥 부르면
    POSTGRES_PASSWORD가 빈 값이 되어 컨테이너가 재시작 루프에 빠지는데, 화면에
    나오는 것은 "비밀번호가 없다"가 아니라 그냥 죽는 컨테이너다. db:up 스크립트가
    --env-file .env.local을 붙여 준다. (dss-auth와 계측기에서 실제로 겪은 함정이다)

    ── 마이그레이션을 자동 적용하지 않는 이유 ──────────────────────────────
    다른 시스템과 같다. 적용 대기가 있으면 알려만 준다. 아침에 창 하나 열었을
    뿐인데 표가 바뀌어 있으면 안 된다.

    ── 이 파일이 저장소 안에 있는 이유 ─────────────────────────────────────
    포털(dss-auth)·회사 홈페이지(dss-home)와 같다. 시작 절차도 코드와 함께
    버전이 매겨져야 한다. 계측기 것만 저장소 밖에 있는데, 그것은 그 저장소가
    "PowerShell 스크립트를 두지 않는다"고 정했기 때문이고 여기엔 그런 결정이 없다.

.PARAMETER WithClaude
    Claude Code를 별도 창으로 띄운다. 바탕화면 '작업 시작' 메뉴는 이걸 켜서 부른다.

.PARAMETER NoServer
    서버는 띄우지 않고 상태 확인까지만 한다.

.PARAMETER SkipPortal
    로그인 포털은 띄우지 않는다. 이미 켜 두었거나, 부르는 쪽(start-all.ps1)이
    따로 켤 때 쓴다. 이때도 3100이 잡혀 있는지는 확인한다 — 포털 없이는 아무것도
    할 수 없기 때문이다.

.EXAMPLE
    .\scripts\start-improvements-work.ps1 -WithClaude
    .\scripts\start-improvements-work.ps1 -NoServer
#>
[CmdletBinding()]
param(
    [switch]$WithClaude,
    [switch]$NoServer,
    [switch]$SkipPortal
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$RepoRoot      = Split-Path -Parent $PSScriptRoot
$DevRoot       = Split-Path -Parent $RepoRoot
$SsoRepo       = Join-Path $DevRoot 'dss-auth'
$SsoStart      = Join-Path $SsoRepo 'scripts\start-sso-work.ps1'
$Container     = 'dss-improvements-postgres-dev'
$DbPort        = 5446
$DevPort       = 3500
$DevUrl        = "http://localhost:$DevPort"
$PortalPort    = 3100
$EnvFile       = Join-Path $RepoRoot '.env.local'
$DockerDesktop = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'

# 네이티브 명령은 cmd를 거쳐 부른다. Windows PowerShell 5.1은 exe의 stderr를
# ErrorRecord로 감싸면서 성공한 명령도 실패로 보이게 만들기 때문이다.
function Invoke-Native([string]$CommandLine) {
    $out = & cmd.exe /c "$CommandLine 2>&1"
    [pscustomobject]@{ Output = ($out -join "`n").Trim(); ExitCode = $LASTEXITCODE }
}

function Write-Step([string]$Text)  { Write-Host ""; Write-Host "▶ $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text)    { Write-Host "  ✔ $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "  ⚠ $Text" -ForegroundColor Yellow }
function Write-Info([string]$Text)  { Write-Host "    $Text" -ForegroundColor DarkGray }

function Test-PortBusy([int]$Port) {
    $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

# 포털이 없으면 이 사이트는 아무것도 못 한다. 그 사실을 한 곳에 모아 둔다 —
# 못 켠 경우와 -SkipPortal로 건너뛴 경우 둘 다 같은 말을 해야 하기 때문이다.
function Write-PortalMissing {
    Write-Host ""
    Write-Host "  ════ 로그인 포털(3100)이 떠 있지 않습니다 ════" -ForegroundColor Red
    Write-Info "개선요청은 자체 로그인 화면이 없습니다. $DevUrl 을 열면 곧바로 포털로"
    Write-Info "넘어가는데, 포털이 없으면 그 자리에서 멈춥니다 — 글 한 줄 읽는 것도 못 합니다."
    Write-Info "화면에는 '포털이 꺼져 있다'가 아니라 그냥 연결 실패만 나옵니다."
    Write-Host ""
    Write-Info "켜는 법 — 새 창에서:"
    Write-Info "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$SsoStart`" -SkipAsSystem"
    Write-Info "  (바탕화면 '작업 시작' 메뉴의 3번도 같은 일을 합니다)"
    Write-Host ""
}

Set-Location $RepoRoot
Write-Host ""
Write-Host "════ DSS 개선요청 작업 시작 ════" -ForegroundColor White
Write-Host "  $RepoRoot" -ForegroundColor DarkGray

# ── 1. Docker 엔진 ────────────────────────────────────────────────────────
Write-Step "Docker 엔진 확인"
if ((Invoke-Native 'docker info --format "{{.ServerVersion}}"').ExitCode -ne 0) {
    if (Test-Path $DockerDesktop) {
        Write-Info "Docker Desktop을 켜는 중… (처음이면 1분 정도)"
        Start-Process $DockerDesktop | Out-Null
        $ready = $false
        foreach ($i in 1..90) {
            Start-Sleep -Seconds 2
            if ((Invoke-Native 'docker info --format "{{.ServerVersion}}"').ExitCode -eq 0) { $ready = $true; break }
            if ($i % 10 -eq 0) { Write-Info "아직 준비 중… ($($i*2)초)" }
        }
        if (-not $ready) {
            Write-Warn2 "Docker가 아직 준비되지 않았습니다. 켜진 뒤 다시 실행하세요."
            exit 1
        }
    } else {
        Write-Warn2 "Docker Desktop을 찾을 수 없습니다: $DockerDesktop"
        Write-Info "직접 실행한 뒤 이 스크립트를 다시 돌려 주세요."
        exit 1
    }
}
Write-Ok "실행 중"

# ── 2. 설정 파일 ──────────────────────────────────────────────────────────
# DB보다 먼저 본다. DEV_POSTGRES_PASSWORD가 비어 있으면 컨테이너가 재시작
# 루프에 빠지는데, 그때 화면에 나오는 것은 "비밀번호가 없다"가 아니라 그냥
# 죽는 컨테이너다. 원인을 여기서 미리 알려 준다.
#
# 🔴 값은 한 글자도 찍지 않는다. 있다/없다와 "32자를 넘는가"만 말한다 —
#    AUTH_SESSION_SECRET 하나면 누구의 세션이든 만들어 낼 수 있기 때문이다.
Write-Step "설정 확인"
$envValues = @{}
if (-not (Test-Path $EnvFile)) {
    Write-Warn2 ".env.local이 없습니다. .env.example을 복사해 채우세요."
    Write-Info "copy .env.example .env.local"
    Write-Info "채울 값은 README의 「처음 한 번 (설치)」에 있습니다."
    exit 1
}
foreach ($line in (Get-Content $EnvFile)) {
    if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') { $envValues[$Matches[1]] = $Matches[2].Trim() }
}
Write-Ok ".env.local 있음"

if (-not $envValues['DEV_POSTGRES_PASSWORD']) {
    Write-Warn2 "DEV_POSTGRES_PASSWORD가 비어 있습니다. DB 컨테이너가 재시작 루프에 빠집니다."
    Write-Info "DATABASE_URL 안의 비밀번호와 같은 값을 넣으세요."
    exit 1
}
if (-not $envValues['DATABASE_URL']) {
    Write-Warn2 "DATABASE_URL이 비어 있습니다. 서버가 뜨자마자 멈춥니다."
    exit 1
}

# 서명 키 둘. 길이만 본다 — 짧으면 서명이 있으나 마나다(둘 다 32자 규칙).
foreach ($name in @('AUTH_SESSION_SECRET', 'SSO_TX_SECRET')) {
    $value = $envValues[$name]
    if (-not $value) {
        Write-Warn2 "$name 이(가) 비어 있습니다 — 로그인이 되지 않습니다."
    } elseif ($value.Length -lt 32) {
        Write-Warn2 "$name 이(가) 32자보다 짧습니다."
        Write-Info "만들기: node -e `"console.log(require('crypto').randomBytes(32).toString('base64url'))`""
    } else {
        Write-Ok "$name 설정됨 (32자 이상)"
    }
}

foreach ($name in @('SSO_CLIENT_ID', 'SSO_CLIENT_SECRET')) {
    if (-not $envValues[$name]) {
        Write-Warn2 "$name 이(가) 비어 있습니다 — 포털이 이 사이트를 알아보지 못합니다."
        Write-Info "포털 등록 절차는 README의 「포털에 등록하기」에 있습니다."
    } else {
        Write-Ok "$name 설정됨"
    }
}

# 첨부 파일 저장 루트. 없으면 첫 첨부 때 만들어지므로 여기서 만들지 않는다.
$uploads = $envValues['UPLOADS_DIR']
if (-not $uploads) {
    Write-Warn2 "UPLOADS_DIR이 비어 있습니다 — 파일 첨부가 실패합니다."
} elseif (Test-Path $uploads) {
    Write-Ok "업로드 폴더 있음"
} else {
    Write-Info "업로드 폴더는 아직 없습니다 — 첫 첨부 때 만들어집니다."
}

# ── 3. 개선요청 DB ────────────────────────────────────────────────────────
# 전용 상자(5446)다. 공용 dss-pg-app(5442)에는 A/S·계측기의 실운영 자료가
# 들어 있어 거기에 얹지 않기로 했다(2026-09-17, README 「정해진 것」).
Write-Step "개선요청 DB 확인"
$up = Invoke-Native 'npm run --silent db:up'
if ($up.ExitCode -ne 0) {
    Write-Warn2 "DB를 띄우지 못했습니다."
    $up.Output -split "`n" | ForEach-Object { Write-Info $_ }
    exit 1
}

$healthy = $false
foreach ($i in 1..30) {
    $state = (Invoke-Native "docker inspect --format ""{{.State.Health.Status}}"" $Container").Output
    if ($state -eq 'healthy') { $healthy = $true; break }
    Start-Sleep -Seconds 2
}
if ($healthy) {
    Write-Ok "준비됨 (127.0.0.1:$DbPort)"
} else {
    Write-Warn2 "DB가 아직 준비되지 않았습니다. 잠시 뒤 다시 확인하세요."
    Write-Info "docker logs $Container --tail 30 으로 원인을 볼 수 있습니다."
}

# ── 4. 포털 주소 점검 ─────────────────────────────────────────────────────
# 포털은 돌아올 주소(redirect_uri)를 문자 단위로 대조한다. 어긋나면 로그인
# 버튼을 누른 뒤에야 막히고, 화면에는 왜 막혔는지 나오지 않는다.
# 이 저장소의 기본값은 auto다 — 실행 시점에 이 기계의 사내망 주소를 찾아 쓰므로
# Wi-Fi가 바뀌어도 고칠 곳이 없다(src/lib/lan-address.ts).
Write-Step "포털 주소 점검"
$issuer   = $envValues['SSO_ISSUER']
$redirect = $envValues['SSO_REDIRECT_URI']

$lan = $null
try {
    $lan = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
           Where-Object { $_.InterfaceAlias -like 'Wi-Fi*' -and $_.PrefixOrigin -eq 'Dhcp' } |
           Select-Object -First 1 -ExpandProperty IPAddress
} catch {}

function Test-AutoValue([string]$Value) {
    return ($Value -eq 'auto' -or $Value -like 'auto:*')
}

# 적힌 주소는 화면에 찍지 않는다 — .env.local의 값이다. 모양만 판정한다.
function Get-UriHost([string]$Uri) {
    if ($Uri -and $Uri -match '://([^:/]+)') { return $Matches[1] }
    return $null
}

$fixedStale = @()
foreach ($pair in @(@{ Name = 'SSO_ISSUER'; Value = $issuer }, @{ Name = 'SSO_REDIRECT_URI'; Value = $redirect })) {
    $value = $pair.Value
    if (-not $value) {
        Write-Warn2 "$($pair.Name) 이(가) 없습니다 — 로그인 왕복이 시작되지 않습니다."
        continue
    }
    if (Test-AutoValue $value) {
        Write-Ok "$($pair.Name) = auto (실행할 때 이 PC의 사내망 주소로 풉니다)"
        continue
    }
    $uriHost = Get-UriHost $value
    if ($uriHost -eq 'localhost' -or $uriHost -eq '127.0.0.1') {
        Write-Info "$($pair.Name) 은 이 PC에서만 쓰는 주소로 고정돼 있습니다."
    } elseif ($uriHost -match '^\d+\.\d+\.\d+\.\d+$' -and $lan -and $uriHost -ne $lan) {
        $fixedStale += $pair.Name
    } else {
        Write-Info "$($pair.Name) 은 주소가 직접 적혀 있습니다."
    }
}

if ($lan) { Write-Info "현재 Wi-Fi    $lan" }
else { Write-Warn2 "Wi-Fi 주소를 읽지 못했습니다. 유선이거나 연결이 끊겼을 수 있습니다." }

if ($fixedStale.Count -gt 0) {
    Write-Host ""
    Write-Warn2 "$($fixedStale -join ' · ') 에 적힌 주소가 지금 Wi-Fi 주소와 다릅니다. 이대로면 로그인이 막힙니다."
    Write-Info "고치는 법 둘 중 하나:"
    Write-Info "  1. .env.local에서 그 값을 auto 로 바꾼다 (권장 — 주소가 바뀌어도 다시 고칠 일이 없다)"
    Write-Info "  2. 지금 주소($lan)로 직접 고쳐 적는다"
    Write-Host ""
}

# ── 5. 저장소 상태 ────────────────────────────────────────────────────────
Write-Step "저장소 상태"
$commit = (Invoke-Native 'git log -1 --format="%h  %ad  %s" --date=format:"%Y-%m-%d %H:%M"').Output
if ($commit) { Write-Info "마지막 커밋  $commit" }
$branch = (Invoke-Native 'git rev-parse --abbrev-ref HEAD').Output
$dirty  = @((Invoke-Native 'git status --porcelain').Output -split "`n" | Where-Object { $_ -ne '' }).Count
Write-Info "브랜치       $branch"
if ($dirty -gt 0) { Write-Warn2 "커밋 안 된 파일 $($dirty)개" } else { Write-Ok "정리된 상태" }

$remotes = @((Invoke-Native 'git remote').Output -split "`n" | Where-Object { $_ -ne '' })
if ($remotes.Count -eq 0) { Write-Warn2 "원격 저장소가 없습니다 — 커밋이 전부 이 PC에만 있습니다" }

# 적용은 자동으로 하지 않는다. 다른 시스템과 같은 이유다.
$migrations = @(Get-ChildItem -Path (Join-Path $RepoRoot 'drizzle') -Filter '*.sql' -ErrorAction SilentlyContinue)
if ($migrations.Count -gt 0) { Write-Info "마이그레이션 파일 $($migrations.Count)개 — 적용은 npm run db:migrate" }

if ($NoServer) {
    Write-Host ""
    Write-Host "준비 완료 (서버는 띄우지 않음). 띄우려면: npm run dev" -ForegroundColor White
    exit 0
}

# ── 6. 로그인 포털 (별도 창) — 있어야만 하는 것 ───────────────────────────
# 포털 쪽 스크립트가 자기 Docker·DB·서명키 점검을 이미 잘 하고 있으므로 그대로
# 부른다. -SkipAsSystem은 A/S 시스템까지 딸려 오지 않게 한다 — 개선요청 로그인에
# 필요한 것은 포털뿐이다.
#
# 다른 사이트와 달리 띄우고 지나가지 않는다. 3100이 실제로 응답할 때까지
# 기다린다 — 포털이 없으면 이 사이트는 화면 하나 보여 주지 못하기 때문이다.
Write-Step "로그인 포털 확인 (필수)"
$portalUp = Test-PortBusy $PortalPort

if ($portalUp) {
    Write-Ok "이미 켜져 있음 (http://localhost:$PortalPort)"
} elseif ($SkipPortal) {
    Write-Warn2 "-SkipPortal 로 불렸는데 3100이 잡혀 있지 않습니다."
    Write-PortalMissing
} elseif (-not (Test-Path $SsoStart)) {
    Write-Warn2 "포털 시작 스크립트를 찾을 수 없습니다: $SsoStart"
    Write-PortalMissing
} else {
    Start-Process cmd -ArgumentList '/c', "title DSS 통합 로그인 - 서버 && cd /d `"$SsoRepo`" && powershell -NoProfile -ExecutionPolicy Bypass -File `"$SsoStart`" -SkipAsSystem" | Out-Null
    Write-Info "별도 창에서 시작했습니다. 그 창이 Docker·DB·서명키를 점검한 뒤 서버를 띄웁니다."
    Write-Info "3100이 응답할 때까지 기다립니다 (최대 3분)…"
    foreach ($i in 1..90) {
        Start-Sleep -Seconds 2
        if (Test-PortBusy $PortalPort) { $portalUp = $true; break }
        if ($i % 15 -eq 0) { Write-Info "아직 준비 중… ($($i*2)초)" }
    }
    if ($portalUp) {
        Write-Ok "포털 준비됨 (http://localhost:$PortalPort)"
    } else {
        Write-Warn2 "3분 안에 뜨지 않았습니다."
        Write-PortalMissing
    }
}

if ($portalUp) {
    # 포털이 떠 있어도 이 사이트가 등록돼 있지 않으면 거절당한다. 등록 여부는
    # 포털 DB를 봐야 알 수 있어 여기서 확인하지 않는다 — 어디를 볼지만 적어 둔다.
    Write-Info "로그인이 '알 수 없는 client_id'로 막히면 아직 등록 전입니다 — README 「포털에 등록하기」."
}

# ── 7. Claude Code (선택) ─────────────────────────────────────────────────
if ($WithClaude) {
    Write-Step "Claude Code 실행"
    $claude = (Get-Command claude -ErrorAction SilentlyContinue)
    if (-not $claude) {
        Write-Warn2 "claude 명령을 찾을 수 없어 건너뜁니다."
        Write-Info "설치: npm install -g @anthropic-ai/claude-code"
    } else {
        # 개발 서버가 이 창을 계속 쓰므로 Claude는 별도 창으로 띄운다.
        # Claude는 켜진 폴더를 작업 폴더로 삼는다 — 그래서 저장소 안에서 띄운다.
        Start-Process cmd -ArgumentList '/c', "title Claude - DSS 개선요청 && cd /d `"$RepoRoot`" && claude" | Out-Null
        Write-Ok "별도 창에서 실행 중 (작업 폴더: dss-improvements)"
    }
}

# ── 8. 개선요청 개발 서버 ─────────────────────────────────────────────────
Write-Step "DSS 개선요청 서버 시작"
Write-Info "$DevUrl — 이 창을 닫으면 서버도 꺼집니다."
if (-not $portalUp) { Write-Warn2 "포털이 없는 상태입니다. 서버는 뜨지만 로그인은 되지 않습니다." }
Write-Host ""

# 서버가 실제로 응답하면 그때 브라우저를 연다. 컴파일 전에 열면 빈 화면을 본다.
#
# 두드리는 곳이 / 가 아니라 /login 인 이유: / 는 세션이 없으면 포털로 넘긴다.
# Invoke-WebRequest 는 그 넘김을 따라가므로, 포털이 꺼져 있으면 우리 서버가
# 멀쩡히 떠 있는데도 실패로 보여 브라우저가 끝내 열리지 않는다. /login 은
# 포털에 가지 않고 이 서버가 직접 그리는 화면이다.
$waiter = @"
foreach (`$i in 1..120) {
    Start-Sleep -Seconds 1
    try {
        Invoke-WebRequest -Uri '$DevUrl/login' -UseBasicParsing -TimeoutSec 2 | Out-Null
        Start-Process '$DevUrl'
        break
    } catch {}
}
"@
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', $waiter | Out-Null

& npm run dev
