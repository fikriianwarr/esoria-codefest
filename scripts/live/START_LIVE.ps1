#requires -Version 5.1
<#
Full deploy for the account owner; no automatic backup by operator request.
The live Firebase project must already belong to the signed-in Google user.
All write operations happen ONLY on the user's local computer after explicit approval.
#>
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$Project='esoria-codefest'
$Root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
function Run-Checked([string]$Label,[string]$Executable,[string[]]$Arguments){
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
    & $Executable @Arguments
    if($LASTEXITCODE -ne 0){throw "$Label gagal (exit $LASTEXITCODE). Proses dihentikan."}
}
# Capture Cloud CLI results safely on Windows PowerShell 5.1. A revoked token can emit
# native stderr; capture it instead of allowing ErrorActionPreference=Stop to abort before recovery.
# Access tokens are NEVER printed to screen, files or logs.
function Invoke-GcloudCaptured {
    param([Parameter(Mandatory=$true)][string[]]$Arguments)
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $out = & gcloud @Arguments 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        return [pscustomobject]@{
            Ok = ($exitCode -eq 0)
            Output = [string]($out.Trim())
            ExitCode = $exitCode
        }
    } catch {
        return [pscustomobject]@{ Ok = $false; Output = $_.Exception.Message; ExitCode = 1 }
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
}
function Renew-GcloudLogin([string]$PreviousAccount) {
    Write-Host 'Token Google Cloud tidak tersedia, kedaluwarsa, atau telah dicabut.' -ForegroundColor Yellow
    Write-Host 'Membuka browser untuk login ulang. Gunakan akun yang memiliki izin pada esoria-codefest.' -ForegroundColor Yellow
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        if ([string]::IsNullOrWhiteSpace($PreviousAccount)) {
            & gcloud auth login '--force'
        } else {
            & gcloud auth login $PreviousAccount '--force'
        }
        if ($LASTEXITCODE -ne 0) { throw 'Login ulang Google Cloud gagal atau dibatalkan. Periksa browser/koneksi.' }
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
}
function Renew-GcloudAdc {
    Write-Host 'Application Default Credentials (ADC) hilang/kedaluwarsa.' -ForegroundColor Yellow
    Write-Host 'Membuka login ADC agar Firebase Admin SDK dapat mengakses Auth/Firestore/Storage.' -ForegroundColor Yellow
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & gcloud auth application-default login
        if ($LASTEXITCODE -ne 0) { throw 'Login ADC gagal atau dibatalkan. Tidak ada perubahan Firebase yang dilakukan.' }
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
}
function Ensure-CloudCredentials {
    if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
        throw 'Google Cloud CLI belum terpasang. Instal dari https://cloud.google.com/sdk/docs/install lalu jalankan CMD kembali.'
    }
    # Target project only for this launcher/child processes; never modify the global CLI project.
    $env:CLOUDSDK_CORE_PROJECT = $Project
    $current = Invoke-GcloudCaptured -Arguments @('auth','list','--filter=status:ACTIVE','--format=value(account)')
    $account = if ($current.Ok) { $current.Output.Trim() } else { '' }
    $token = Invoke-GcloudCaptured -Arguments @('auth','print-access-token','--quiet')
    $didRenew = $false
    if ([string]::IsNullOrWhiteSpace($account) -or -not $token.Ok -or [string]::IsNullOrWhiteSpace($token.Output)) {
        Renew-GcloudLogin -PreviousAccount $account
        $didRenew = $true
    }
    # Check a real authenticated operation, not merely 'gcloud auth list' (which can show an expired account).
    $current = Invoke-GcloudCaptured -Arguments @('auth','list','--filter=status:ACTIVE','--format=value(account)')
    if (-not $current.Ok -or [string]::IsNullOrWhiteSpace($current.Output)) {
        throw 'Akun Google Cloud belum aktif seusai login ulang.'
    }
    $account = $current.Output.Trim()
    $token = Invoke-GcloudCaptured -Arguments @('auth','print-access-token','--quiet')
    if (-not $token.Ok -or [string]::IsNullOrWhiteSpace($token.Output)) {
        throw 'Token gcloud masih tidak valid setelah login. Jalankan manual: gcloud auth login --force'
    }
    # No sensitive token output; drop local reference as soon as validation completes.
    $token = $null
    Write-Host "Akun Google Cloud terverifikasi: $account" -ForegroundColor Cyan
    $visible = Invoke-GcloudCaptured -Arguments @('projects','describe',$Project,'--format=value(projectId)')
    if (-not $visible.Ok -and -not $didRenew -and $visible.Output -match 'invalid_grant|expired or revoked|reauthenticat|token.*(expired|revoked)') {
        Renew-GcloudLogin -PreviousAccount $account
        $didRenew = $true
        $visible = Invoke-GcloudCaptured -Arguments @('projects','describe',$Project,'--format=value(projectId)')
    }
    if (-not $visible.Ok -or $visible.Output.Trim() -cne $Project) {
        if ($visible.Output -match 'invalid_grant|expired or revoked|reauthenticat') {
            throw "Kredensial gcloud masih ditolak. Tutup launcher, jalankan 'gcloud auth login --force' di PowerShell, lalu ulangi."
        }
        throw "Project $Project tidak dapat diakses akun $account. Pastikan izin IAM dan koneksi. Detail: $($visible.Output)"
    }
    $adc = Invoke-GcloudCaptured -Arguments @('auth','application-default','print-access-token')
    if (-not $adc.Ok -or [string]::IsNullOrWhiteSpace($adc.Output)) {
        if (-not [string]::IsNullOrWhiteSpace($env:GOOGLE_APPLICATION_CREDENTIALS)) {
            throw 'GOOGLE_APPLICATION_CREDENTIALS menunjuk kredensial khusus yang tidak valid. Perbaiki variabel itu sebelum login ADC; tidak ada perubahan Firebase.'
        }
        Renew-GcloudAdc
        $adc = Invoke-GcloudCaptured -Arguments @('auth','application-default','print-access-token')
        if (-not $adc.Ok -or [string]::IsNullOrWhiteSpace($adc.Output)) {
            throw 'ADC masih tidak valid setelah login. Jalankan manual: gcloud auth application-default login'
        }
    }
    $adc = $null
    Write-Host "Akses Google Cloud dan ADC untuk $Project berhasil diverifikasi." -ForegroundColor Green
}
# No persistent logs by default. Enable an optional local transcript only when
# explicitly troubleshooting with ESORIA_SAVE_DEPLOY_LOG=1.
$transcriptStarted = $false
$locationPushed = $false
try {
    if ([Environment]::GetEnvironmentVariable('ESORIA_SAVE_DEPLOY_LOG','Process') -eq '1') {
        Start-Transcript -Path (Join-Path $Root 'deploy-last.log') -Force | Out-Null
        $transcriptStarted = $true
    }
    Push-Location $Root
    $locationPushed = $true
    . (Join-Path $PSScriptRoot 'USE_NODE22_PORTABLE.ps1')
    Enable-ESORIA_Node22
    if(-not (Get-Command node.exe -ErrorAction SilentlyContinue)){throw 'Node.js 22 belum tersedia.'}
    if(-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)){throw 'npm belum tersedia.'}
    $nodeVersion=(& node.exe --version).Trim()
    if($nodeVersion -notmatch '^v22\.'){throw "Node.js 22 diperlukan; yang ditemukan $nodeVersion"}
    $firebaserc=Get-Content -Raw '.firebaserc' | ConvertFrom-Json
    if($firebaserc.projects.default -cne $Project){throw 'Project Firebase source tidak cocok.'}
    Ensure-CloudCredentials
    $active=Invoke-GcloudCaptured -Arguments @('auth','list','--filter=status:ACTIVE','--format=value(account)')
    if(-not $active.Ok -or $active.Output.Trim().ToLowerInvariant() -cne 'fikrianwar2000@gmail.com'){
        throw 'Untuk sinkronisasi admin, login gcloud harus tepat fikrianwar2000@gmail.com. Tidak ada hak admin yang diberikan otomatis kepada akun lain.'
    }
    $env:GOOGLE_CLOUD_PROJECT=$Project
    if (-not (Test-Path 'functions/node_modules/firebase-admin' -PathType Container)) {
        Run-Checked 'Instal Firebase Admin SDK sesuai lockfile' 'npm.cmd' @('ci','--prefix','functions','--no-fund','--no-audit')
    }
    Write-Host "`n=== Cek akun admin Firebase (hanya baca) ===" -ForegroundColor Cyan
    & node.exe 'scripts/live/sync-admin.mjs' '--plan'
    $adminCode=$LASTEXITCODE
    $AdminReady=($adminCode -eq 0)
    if ($adminCode -eq 12) {
        Write-Host 'Akun admin belum ditemukan. Sinkronisasi admin dilewati.' -ForegroundColor Yellow
    } elseif ($adminCode -ne 0) {
        throw "Pemeriksaan admin gagal (exit $adminCode). Tidak melanjutkan."
    }
    Write-Host "`n=== Memulai pemeriksaan dan full deploy ===" -ForegroundColor Cyan
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts/DEPLOY_FULL_FIREBASE.ps1') -ProjectRoot $Root
    if($LASTEXITCODE -ne 0){throw 'Deployment berhenti; sinkronisasi admin belum dilakukan oleh launcher.'}
    if ($AdminReady) {
        # Only the existing, verified owner account may be synchronized; the SDK
        # validates Auth email, UID, active status and conflicting registrations.
        $env:ESORIA_ADMIN_SYNC_CONSENT="AKTIFKAN ADMIN $Project fikrianwar2000@gmail.com"
        Run-Checked 'Sinkronisasi admin terverifikasi (Auth claim dan admins/UID)' 'node.exe' @('scripts/live/sync-admin.mjs','--apply')
        Run-Checked 'Verifikasi admin' 'node.exe' @('scripts/live/sync-admin.mjs','--verify')
    } else {
        Write-Host 'Akun admin belum ada. Deploy aplikasi selesai, sinkronisasi admin dilewati.' -ForegroundColor Yellow
    }
    Write-Host "`nSELESAI: Full deploy telah dijalankan." -ForegroundColor Green
    Write-Host 'Periksa riwayat deploy, data peserta dan hasil aktual di Firebase Console.' -ForegroundColor Yellow
    Write-Host 'Website: https://esoria-codefest.web.app/' -ForegroundColor Green
} catch {
    Write-Host "`nPROSES BELUM TUNTAS: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Jangan hapus data. Tinjau tahap terakhir dan jalankan pemeriksaan awal sebelum mencoba lagi.' -ForegroundColor Yellow
    exit 1
} finally {
    Remove-Item Env:\ESORIA_ADMIN_SYNC_CONSENT -ErrorAction SilentlyContinue
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
    if ($locationPushed) { Pop-Location }
    # Firebase CLI/Emulator may create debug files; clear these generated
    # artifacts without touching user documents or Firebase cloud resources.
    Get-ChildItem -LiteralPath $Root -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(?:firebase|firestore|database|pubsub|ui)-debug(?:\.[^.]+)?\.log$' } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}
