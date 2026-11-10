#requires -Version 5.1
<#
ESORIA CodeFest — non-interactive production redeploy after strict preflight (no data deletion).
Targets ONLY project esoria-codefest. No Auth/Firestore/Storage data imports,
no --force, no unattended deletion of functions, no CORS or migration by default.
Only non-destructive changes are scripted; rollback is not guaranteed without backups.
Auth, Secret Manager, IAM, and Hosting history require separate operator recovery plans.
#>
[CmdletBinding()]
param(
    [switch]$SkipIndexes,
    [switch]$ApplyStorageCors,
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$ReinstallDependencies
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Project = 'esoria-codefest'
$Root = $ProjectRoot
if (-not (Test-Path -LiteralPath (Join-Path $Root 'firebase.json') -PathType Leaf)) {
    throw 'Folder project tidak lengkap. Jalankan hanya dari folder hasil ekstraksi esoria_codefest.zip.'
}
$Root = (Resolve-Path -LiteralPath $Root).Path
function Require-File([string]$Relative) {
    $p = Join-Path $Root $Relative
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "File penting tidak ditemukan: $Relative" }
}
function Native([string]$Label,[string]$Executable,[string[]]$Argv) {
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
    & $Executable @Argv
    if ($LASTEXITCODE -ne 0) { throw "Gagal pada '$Label' (exit $LASTEXITCODE). Tidak melanjutkan tahap berikutnya." }
}
function Enable-Node22 {
    $v = ''
    try { $v = (& node.exe --version).Trim() } catch {}
    if ($v -match '^v22\.') { return }
    $basePaths = @(
        (Join-Path $env:LOCALAPPDATA 'ESORIA_Node22'),
        (Join-Path $env:LOCALAPPDATA 'ESORIA-Tools')
    )
    $candidates = @(
        foreach ($base in $basePaths) {
            if (Test-Path -LiteralPath $base -PathType Container) {
                Get-ChildItem -LiteralPath $base -Directory -Filter 'node-v22*-win-*' -ErrorAction SilentlyContinue |
                    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') -PathType Leaf }
            }
        }
    ) | Sort-Object Name -Descending
    if ($candidates.Count -gt 0) {
        $env:Path = $candidates[0].FullName + [IO.Path]::PathSeparator + $env:Path
    }
    try { $v = (& node.exe --version).Trim() } catch { throw 'Node.js 22 belum tersedia.' }
    if ($v -notmatch '^v22\.') { throw "Node.js 22 diperlukan, yang aktif $v. Pastikan Node22 portable sebelumnya masih ada." }
}
function Existing-Flag([string]$Flag) {
    # Query read-only. Prevent reducing MFA controls already enabled on live functions.
    $result = (& gcloud functions describe esoriaApi --gen2 --region asia-southeast2 --project $Project `
        --format "value(serviceConfig.environmentVariables.$Flag)") -join ''
    if ($LASTEXITCODE -ne 0) { throw "Tidak dapat memeriksa keamanan live: $Flag" }
    return $result.Trim()
}
try {
    foreach ($file in @(
        'firebase.json','.firebaserc','firestore.rules','storage.rules','firestore.indexes.json',
        'storage.cors.json','package.json','package-lock.json','functions/package.json',
        'functions/package-lock.json','functions/.env.esoria-codefest','scripts/check-admin-security.mjs','public/index.html',
        'public/firebase-config.js','scripts/check-project.mjs','scripts/prepare-assets.mjs','scripts/check-release.mjs'
    )) { Require-File $file }
    $firebaseRc = Get-Content -LiteralPath (Join-Path $Root '.firebaserc') -Raw | ConvertFrom-Json
    $fb = Get-Content -LiteralPath (Join-Path $Root 'firebase.json') -Raw | ConvertFrom-Json
    if ($firebaseRc.projects.default -cne $Project -or $fb.hosting.public -cne 'public') {
        throw 'Project atau root hosting tidak sesuai. Proses dibatalkan.'
    }
    if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'Google Cloud CLI (gcloud) tidak ditemukan.' }
    Enable-Node22
    $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
    $npmExe = (Get-Command npm.cmd -ErrorAction Stop).Source
    Write-Host "`nESORIA CODEFEST | PROJECT: $Project" -ForegroundColor Cyan
    Write-Host "Source: $Root"
    Write-Host "Node: $(& $nodeExe --version)"
    Write-Host 'TANPA BACKUP otomatis sesuai pilihan operator. Pastikan izin dan tahap uji sebelum rilis.' -ForegroundColor Yellow
    Write-Host 'Publikasi Rules dan Functions dapat mengubah perilaku login/akses. Jangan deploy di tengah kompetisi/transaksi.' -ForegroundColor Yellow
    Push-Location $Root
    try {
        $depsReady = (Test-Path -LiteralPath (Join-Path $Root 'node_modules/firebase-tools/lib/bin/firebase.js') -PathType Leaf) -and
                     (Test-Path -LiteralPath (Join-Path $Root 'functions/node_modules') -PathType Container)
        if ($ReinstallDependencies -or -not $depsReady) {
            Native 'Pasang dependensi project' $npmExe @('ci','--no-fund')
            Native 'Pasang dependensi backend' $npmExe @('--prefix','functions','ci','--no-fund')
        } else {
            Write-Host 'Dependensi dari percobaan sebelumnya ditemukan; npm ci tidak diulang.' -ForegroundColor Green
        }
        $firebaseCli = Join-Path $Root 'node_modules/firebase-tools/lib/bin/firebase.js'
        if (-not (Test-Path -LiteralPath $firebaseCli)) { throw 'Firebase CLI lokal tidak ditemukan.' }
        # gcloud / ADC login is not interchangeable with the Firebase CLI OAuth cache.
        # Query this exact project instead of a global project listing, which can fail even
        # when a user can access a particular Firebase project.
        # An ordinary `firebase login` does NOT refresh a previously logged-in session.
        Write-Host "`n=== Verifikasi Firebase CLI terhadap project yang dituju ===" -ForegroundColor Cyan
        Write-Host "Mencoba akses Firebase Apps pada $Project tanpa mengubah project atau data..." -ForegroundColor Cyan
        & $nodeExe $firebaseCli 'apps:list' '--project' $Project
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Akses Firebase CLI gagal. Meminta otorisasi ulang (bukan login biasa).' -ForegroundColor Yellow
            Write-Host 'Gunakan akun Google yang memiliki izin Firebase pada project esoria-codefest.' -ForegroundColor Yellow
            & $nodeExe $firebaseCli 'login' '--reauth'
            if ($LASTEXITCODE -ne 0) { throw 'Login ulang Firebase CLI dibatalkan/gagal. Jalankan firebase login --reauth dan periksa koneksi.' }
            Write-Host 'Jika ini masih gagal, baca firebase-debug.log di folder proyek; cek proxy/firewall dan izin Firebase Management API.' -ForegroundColor Yellow
            Native 'Verifikasi izin Firebase pada project esoria-codefest' $nodeExe @($firebaseCli,'apps:list','--project',$Project)
        }
        Write-Host 'Firebase CLI berhasil mengakses project tujuan tanpa harus mencantumkan semua project.' -ForegroundColor Green
        Native 'Audit kelengkapan rilis dua akun' $nodeExe @('scripts/check-release.mjs')
        Native 'Verifikasi kebersihan paket produksi' $nodeExe @('scripts/live/verify-source.mjs')
        Native 'Periksa keselarasan keamanan MFA backend dan Rules' $nodeExe @('scripts/check-admin-security.mjs')
        Native 'Validasi project Firebase' $nodeExe @('scripts/environment-preflight.mjs','--project',$Project)
        Native 'Buat hash aset' $nodeExe @('scripts/prepare-assets.mjs')
        Native 'Periksa source dan tautan' $nodeExe @('scripts/check-project.mjs')
        Native 'Audit stylesheet dan budget' $nodeExe @('scripts/audit-css-budget.mjs')
        Native 'Lint' $npmExe @('run','lint')
        Native 'Tes regresi, unit dan alur penilaian admin' $npmExe @('test')
        # Mandatory because Admin/Member authorization and certificate issuance changed.
        Native 'Tes emulator keamanan dan alur Admin/Member (WAJIB)' $npmExe @('run','test:emulator')
        # Inspect Secret Manager metadata only. Never print the production secret value.
        Write-Host "`n=== Periksa metadata secret CTF (tanpa menampilkan nilai) ===" -ForegroundColor Cyan
        $secretRaw = & gcloud secrets versions list CTF_FLAG_PEPPER "--project=$Project" '--format=json(state)'
        if ($LASTEXITCODE -ne 0) { throw 'Tidak dapat memeriksa versi Secret Manager CTF_FLAG_PEPPER.' }
        $secretVersions = @((($secretRaw -join "`n") | ConvertFrom-Json) | Where-Object { $_ -and $_.state -eq 'ENABLED' })
        if ($secretVersions.Count -lt 1) { throw 'Tidak ada versi secret CTF_FLAG_PEPPER yang ENABLED.' }
        Write-Host 'Secret CTF tersedia; nilainya tidak dicetak.' -ForegroundColor Green
        # Keep production project and MFA protections immediately before approval.
        $liveId = (& gcloud config get-value project 2>$null | Out-String).Trim()
        if ($liveId -ne $Project) { throw "Project gcloud aktif ($liveId) berbeda dari $Project" }
        $runtimeEnv = Get-Content -LiteralPath (Join-Path $Root 'functions/.env.esoria-codefest') -Raw
        foreach ($flag in @('REQUIRE_ADMIN_MFA','REQUIRE_RECENT_ADMIN_AUTH')) {
            $value = Existing-Flag $flag
            if ($value -ieq 'true' -and $runtimeEnv -notmatch ('(?m)^' + $flag + '=true\s*$')) {
                throw "MFA live ($flag=true) tidak boleh diturunkan oleh source ini. Sesuaikan .env dahulu."
            }
        }
        if ($runtimeEnv -match '(?m)^REQUIRE_ADMIN_MFA=false\s*$') {
            Write-Host 'PENTING: MFA admin masih staged (belum diwajibkan). Jangan anggap akun admin sudah terlindung MFA.' -ForegroundColor Yellow
        }
        Write-Host 'Semua pemeriksaan lulus. Memulai full deploy non-interaktif (tanpa --force).' -ForegroundColor Cyan
        if (-not $SkipIndexes) {
            Native 'Lihat indeks Firestore saat ini' $nodeExe @($firebaseCli,'firestore:indexes','--project',$Project)
            Write-Host 'Jika indeks lama perlu dihapus, CLI non-interaktif harus berhenti; tidak menghapus indeks otomatis.' -ForegroundColor Yellow
            Native 'Deploy indeks Firestore (tanpa --force)' $nodeExe @($firebaseCli,'deploy','--non-interactive','--project',$Project,'--only','firestore:indexes')
            $indexRaw = (& gcloud firestore indexes composite list '--database=(default)' "--project=$Project" '--format=json') -join "`n"
            if ($LASTEXITCODE -ne 0) { throw 'Tidak bisa memeriksa status indeks.' }
            $indexList = @($indexRaw | ConvertFrom-Json)
            if (@($indexList | Where-Object { $_.state -eq 'NEEDS_REPAIR' }).Count -gt 0) {
                throw 'Indeks membutuhkan perbaikan. Jangan lanjut ke Rules/Functions.'
            }
            if (@($indexList | Where-Object { $_.state -ne 'READY' }).Count -gt 0) {
                throw 'Indeks Firestore belum READY. Deployment berhenti sebelum Rules/Functions/Hosting. Tunggu seluruh indeks READY, lalu jalankan launcher lagi.'
            }
        } else {
            Write-Host 'SKIP indeks berdasarkan parameter operator.' -ForegroundColor Yellow
        }
        Native 'Publish Firestore Rules' $nodeExe @($firebaseCli,'deploy','--non-interactive','--project',$Project,'--only','firestore:rules')
        Native 'Publish Cloud Storage Rules' $nodeExe @($firebaseCli,'deploy','--non-interactive','--project',$Project,'--only','storage')
        # Firebase CLI has a short 10-second default for function specification discovery.
        # On Windows, cold-loading the Firebase Admin SDK / sharp can exceed that
        # even when all functions load correctly in the Emulator. Firebase officially
        # supports FUNCTIONS_DISCOVERY_TIMEOUT (seconds). Never skip lint or tests.
        $previousDiscoveryTimeout = [Environment]::GetEnvironmentVariable('FUNCTIONS_DISCOVERY_TIMEOUT', 'Process')
        try {
            $env:FUNCTIONS_DISCOVERY_TIMEOUT = '120'
            Write-Host 'Firebase Functions discovery timeout: 120 detik (hanya proses deploy Functions).' -ForegroundColor Cyan
            Native 'Redeploy 6 Cloud Functions (termasuk esoriaPublic)' $nodeExe @(
                $firebaseCli,'deploy','--non-interactive','--project',$Project,'--only',
                'functions:esoriaApi,functions:esoriaCtf,functions:esoriaPublic,functions:purgeExpiredPaymentProofs,functions:purgeStaleCompetitionFiles,functions:sendParticipantPush'
            )
        } finally {
            if ([string]::IsNullOrEmpty($previousDiscoveryTimeout)) {
                Remove-Item Env:\FUNCTIONS_DISCOVERY_TIMEOUT -ErrorAction SilentlyContinue
            } else {
                $env:FUNCTIONS_DISCOVERY_TIMEOUT = $previousDiscoveryTimeout
            }
        }
        if ($ApplyStorageCors) {
            Native 'Validasi CORS' $nodeExe @('scripts/validate-cors.mjs','--project',$Project)
            $bucket = (& $nodeExe 'scripts/runtime-bucket.mjs' '--project' $Project | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or -not $bucket) { throw 'Bucket Storage tidak terverifikasi.' }
            Native 'Update Storage CORS' 'gcloud' @('storage','buckets','update',"gs://$bucket","--project=$Project",'--cors-file=storage.cors.json')
        }
        Write-Host 'Verifikasi Cloud Function publik sebelum Hosting live dipublikasikan.' -ForegroundColor Yellow
        $publicJson = & gcloud functions describe esoriaPublic '--gen2' '--region=asia-southeast2' "--project=$Project" '--format=json(state,serviceConfig.uri)'
        if ($LASTEXITCODE -ne 0) { throw 'Gagal membaca status esoriaPublic.' }
        $publicInfo = ($publicJson -join "`n") | ConvertFrom-Json
        if ($publicInfo.state -ne 'ACTIVE' -or $publicInfo.serviceConfig.uri -notmatch '^https://') { throw 'esoriaPublic belum ACTIVE atau URL-nya tidak tersedia.' }
        $query = '?kind=results&periodId=2026-10&package=web&wave=wave-01'
        try {
            $probe = Invoke-RestMethod -Uri ($publicInfo.serviceConfig.uri.TrimEnd('/') + '/' + $query) -TimeoutSec 35
            if ($probe.ok -ne $true -or $null -eq $probe.data.published) { throw 'Respons bukan data arsip publik.' }
        } catch { throw "esoriaPublic belum dapat dibaca anonim. Hosting lama dipertahankan: $($_.Exception.Message)" }
        Write-Host 'GET Cloud Function publik: BERHASIL' -ForegroundColor Green
        Native 'Publish Hosting ke website live' $nodeExe @($firebaseCli,'deploy','--non-interactive','--project',$Project,'--only','hosting')
        try {
            $probeHosting = Invoke-RestMethod -Uri ('https://esoria-codefest.web.app/api/public' + $query) -TimeoutSec 40
            if ($probeHosting.ok -ne $true -or $null -eq $probeHosting.data.published) { throw 'Respons rewrite bukan data arsip publik.' }
        } catch { throw "Hosting dipublikasikan tetapi rewrite API belum valid: $($_.Exception.Message)" }
        Write-Host 'GET arsip publik lewat Hosting: BERHASIL' -ForegroundColor Green
        Write-Host "`nFIREBASE DEPLOY COMMANDS SUKSES. Website: https://esoria-codefest.web.app/" -ForegroundColor Green
        Native 'Smoke check read-only seluruh halaman dan API publik' $nodeExe @('scripts/verify-public-release.mjs')
        Write-Host 'WAJIB cek manual: Auth/MFA, pembayaran, App Check, CTF, scheduler, notifikasi, izin akses.' -ForegroundColor Yellow
        Write-Host 'Script tidak menjalankan migrasi data / reset database dan tidak mengganti Auth/Secrets.'
    } finally { Pop-Location }
} catch {
    Write-Host "`nREDEPLOY BERHENTI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
