#Requires -Version 5.1
<#
.SYNOPSIS
    DSS 개선요청 작업 종료 — 3500번 서버를 끄고 DB 컨테이너를 세운다.

.DESCRIPTION
    start-improvements-work.ps1과 짝이고, dss-home의 end-home-work.ps1과 같은
    순서로 같은 것을 확인한다. 바탕화면의 "작업 종료"가 이 스크립트를 함께
    부른다(..\..\end-all.ps1).

    ── 왜 DB 백업이 없는가 (판단, 2026-09-18) ──────────────────────────────
    A/S 쪽은 끄기 전에 pg_dump를 뜬다. 거기 담긴 수리 접수·고객사는 이 PC에만
    있고 잃으면 되살릴 방법이 없기 때문이다. 이 컨테이너는 다르다.
    **개발용**이다(dss-improvements-postgres-dev, 127.0.0.1:5446 — 공용
    dss-pg-app에 얹지 않고 혼자 세운 상자다). 실제로 받는 개선요청은 NAS에
    따로 서는 운영 쪽에 쌓이고, 백업은 그쪽이 맡는다(dss-deploy). 여기 담긴
    글과 상태는 시험 자료라서, 잃어도 다시 만들면 된다.

    게다가 DB를 떠도 반쪽이다. 사람이 올린 스크린샷 같은 실제 파일은 DB가
    아니라 UPLOADS_DIR(이 PC에서는 C:\DSS-IMPROVEMENTS-DATA\uploads)에 있어
    덤프에 따라오지 않는다. 반쪽짜리 덤프를 매일 뜨면 "백업이 있다"고 믿게
    되는 쪽이 더 위험하고, 손님 이름이 적힌 파일이 이 PC에 하나 더 생긴다.

    🔴 그러니 **빠뜨린 것이 아니라 정한 것이다.** 이 개발 DB로 되살릴 수 없는
    자료를 받기 시작하는 날(예: 이 상자를 잠깐이라도 실사용으로 쓰는 날)에는
    다시 정해야 한다. 그때는 A/S의 end-work.ps1이 뜨는 방식이 본보기다.

    ── 첨부 파일 폴더는 건드리지 않는다 ────────────────────────────────────
    UPLOADS_DIR는 컨테이너 밖 폴더라 컨테이너를 세워도 파일은 그대로 남는다.
    이 스크립트는 그 폴더를 읽지도 지우지도 않는다.

    ── 안 하는 일 ──────────────────────────────────────────────────────────
    커밋도 푸시도 하지 않는다. 알려만 준다 — 무엇을 남길지는 사람이 정한다.
    컨테이너는 stop만 하고 지우지 않는다. `docker compose down -v`는 볼륨을
    지워 DB를 통째로 날리므로 이 스크립트는 그 명령을 쓰지 않는다.
    포털(3100)은 건드리지 않는다. 시작할 때는 포털까지 함께 폈지만 — 이 사이트는
    자체 로그인 화면이 없어 포털 없이는 화면 하나 못 그린다 — 끌 때 여기서
    포털까지 끄면 아직 포털에 기대고 있는 다른 사이트(계측기·홈페이지)가
    로그인만 안 되는 상태로 남는다. 포털은 저쪽 종료 스크립트가 맨 마지막에 끈다.
    Claude Code 창도 건드리지 않는다 — 대화는 서버와 함께 끝나는 것이 아니다.

    ── 대신 멈춘다 ─────────────────────────────────────────────────────────
    안 올린 것이 있으면 알리는 데서 그치지 않고 **끄는 것을 멈춘다.** 서버와
    DB가 켜진 채여서 그 자리에서 바로 커밋하면 된다. 알고도 그대로 끄려면 -Force.

    ── 이 파일이 저장소 안에 있는 이유 ─────────────────────────────────────
    짝이 되는 start-improvements-work.ps1이 `scripts\`에 있으니 종료도 같은
    자리에 둔다. 켜는 절차와 끄는 절차가 갈라져 있으면 한쪽만 고쳐지기 때문이다.
    CLAUDE.md의 "PowerShell 스크립트를 만들지 않는다"는 앱의 배치 작업(데이터를
    돌리는 일)을 두고 한 말로 읽는다 — 그쪽은 TypeScript + tsx다. 개발 PC를
    켜고 끄는 스크립트는 앱 코드가 아니고, 운영(NAS)에서는 아예 쓰이지 않는다.

    ── npm run work:end 이 없는 이유 ───────────────────────────────────────
    다른 저장소에는 그 단축이 있지만 여기엔 아직 없다. package.json은 이 조각의
    범위 밖이라 건드리지 않았다. 아래 .EXAMPLE 처럼 경로로 부르면 된다.

.PARAMETER Force
    안 올린 것이 있어도 멈추지 않고 끝까지 끈다. 오늘 남긴 것을 알고 있고
    그대로 두기로 정했을 때만.

.PARAMETER DryRun
    무엇을 할지 보여 주기만 하고 실제로는 아무것도 끄지 않는다.

.PARAMETER NoFooter
    마지막 "정리 끝" 인사를 찍지 않는다. 바탕화면 '작업 종료'가 여러 스크립트를
    이어 부를 때, 끝인사가 여러 번 나오면 어디가 진짜 끝인지 알 수 없다.
    그 자리에서는 ..\..\end-all.ps1이 한 번만 인사한다. 혼자 돌릴 때는 붙이지 않는다.

.EXAMPLE
    .\scripts\end-improvements-work.ps1 -DryRun
    .\scripts\end-improvements-work.ps1
    .\scripts\end-improvements-work.ps1 -Force
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$DryRun,
    [switch]$NoFooter
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$Container = 'dss-improvements-postgres-dev'
$DevPort   = 3500

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

Write-Host ""
Write-Host "════ DSS 개선요청 종료 ════" -ForegroundColor White
Write-Host "  $RepoRoot" -ForegroundColor DarkGray
if ($DryRun) { Write-Host "  [연습 모드] 실제로는 아무것도 끄지 않습니다." -ForegroundColor Magenta }

# 폴더가 없어도 서버와 컨테이너는 켜져 있을 수 있다. 저장소 확인만 건너뛰고
# 끄는 일은 그대로 한다 — 켜진 채로 남기는 것이 더 나쁘다.
$hasRepo = Test-Path $RepoRoot
if ($hasRepo) { Set-Location $RepoRoot } else { Write-Warn2 "저장소 폴더가 없습니다. 서버와 DB만 끕니다." }

# ── 1. 남긴 것 확인 (먼저 보여 준다 — 끄고 나서 알면 늦다) ────────────────
$blockers = @()   # 하나라도 차면 서버를 끄지 않는다

if ($hasRepo) {
    Write-Step "안 올린 작업 확인"
    $dirtyLines = @((Invoke-Native 'git status --porcelain').Output -split "`n" | Where-Object { $_ -ne '' })

    if ($dirtyLines.Count -gt 0) {
        Write-Warn2 "커밋하지 않은 파일 $($dirtyLines.Count)개 — 이 PC에만 있습니다"
        $dirtyLines | Select-Object -First 8 | ForEach-Object { Write-Info $_ }
        if ($dirtyLines.Count -gt 8) { Write-Info "… 외 $($dirtyLines.Count - 8)개" }
        $blockers += "커밋하지 않은 파일 $($dirtyLines.Count)개"
    } else {
        Write-Ok "커밋하지 않은 파일 없음"
    }

    # 원격이 없으면 "몇 개를 안 올렸나"를 셀 수가 없다 — 전부 안 올린 것이다.
    # 셀 수 없는 것을 위반으로 삼으면 매번 문이 잠기므로, 알리기만 하고 지나간다.
    $remotes = @((Invoke-Native 'git remote').Output -split "`n" | Where-Object { $_ -ne '' })
    if ($remotes.Count -eq 0) {
        Write-Warn2 "원격 저장소가 없습니다 — 커밋이 전부 이 PC에만 있습니다 (종료는 막지 않습니다)"
    } else {
        $unpushed = (Invoke-Native 'git rev-list --count "@{u}..HEAD"').Output
        if ($unpushed -match '^\d+$') {
            if ([int]$unpushed -gt 0) {
                Write-Warn2 "깃허브에 안 올린 커밋 $($unpushed)개 — 이 PC에만 있습니다"
                $blockers += "푸시하지 않은 커밋 $($unpushed)개"
            } else {
                Write-Ok "전부 깃허브에 올라가 있습니다"
            }
        } else {
            Write-Warn2 "업스트림이 없어 푸시 여부를 확인하지 못했습니다 (종료는 막지 않습니다)"
        }
    }
}

# ── 2. 안 올린 것이 있으면 여기서 멈춘다 ──────────────────────────────────
if ($blockers.Count -gt 0) {
    if ($Force) {
        Write-Warn2 "-Force — 안 올린 것이 있지만 그대로 종료합니다 ($($blockers -join ', '))"
    } else {
        Write-Host ""
        Write-Host "════ 종료를 멈췄습니다 ════" -ForegroundColor Yellow
        foreach ($b in $blockers) { Write-Host "  $($b)가 남아 있습니다." -ForegroundColor Yellow }
        Write-Host "  개선요청의 서버와 DB는 켜둔 채입니다." -ForegroundColor Gray
        Write-Host "  커밋 후 다시 실행하거나, 그대로 끄려면:" -ForegroundColor Gray
        Write-Host "    powershell -File .\scripts\end-improvements-work.ps1 -Force" -ForegroundColor DarkGray
        Write-Host ""
        exit 1
    }
}

# ── 3. 개발 서버 ──────────────────────────────────────────────────────────
Write-Step "개선요청 서버 종료 ($DevPort)"
$listener = Get-NetTCPConnection -LocalPort $DevPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) {
    Write-Ok "이미 꺼져 있음"
} else {
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -notin @('node', 'next-server')) {
        # 3500번을 쓰는 것이 우리 서버가 아니면 건드리지 않는다.
        Write-Warn2 "$DevPort`번 포트를 '$($proc.ProcessName)'이 쓰고 있어 그대로 둡니다."
    } elseif (-not $proc) {
        Write-Warn2 "$DevPort`번을 쓰는 프로세스를 찾지 못했습니다."
    } elseif ($DryRun) {
        Write-Info "종료할 프로세스: $($proc.ProcessName) (PID $($proc.Id))"
    } else {
        Stop-Process -Id $proc.Id -Force
        Write-Ok "종료됨 (PID $($proc.Id))"
    }
}

# ── 4. 컨테이너 정지 (자료는 그대로 남는다) ───────────────────────────────
Write-Step "개선요청 DB 컨테이너 정지"
$running = (Invoke-Native "docker ps --filter name=^/$Container`$ --format `"{{.Names}}`"").Output
if ($running -ne $Container) {
    Write-Ok "이미 꺼져 있음"
} elseif ($DryRun) {
    Write-Info "실행할 명령: docker stop $Container"
} else {
    $stop = Invoke-Native "docker stop $Container"
    if ($stop.ExitCode -eq 0) {
        Write-Ok "정지됨 — 자료는 볼륨에 그대로 남아 있습니다"
    } else {
        Write-Warn2 "정지 실패:"; Write-Host $stop.Output
    }
}

if (-not $NoFooter) {
    Write-Host ""
    Write-Host "════ DSS 개선요청 정리 끝 ════" -ForegroundColor White
    Write-Host ""
}
