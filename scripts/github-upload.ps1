#requires -Version 5.1
<#
ESORIA CodeFest - upload GitHub (bukan deploy Firebase).
Target default: fikriianwarr/esoria-codefest, public, branch main.
Syarat: Git for Windows, GitHub CLI, akun GitHub berizin, dan internet.
Tidak ada force push, git reset --hard, penghapusan remote, atau Firebase deploy.

Override opsional di CMD sebelum menjalankan upload.cmd:
  set "ESORIA_GITHUB_REPO=owner/nama-repo"
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$Target = 'fikriianwarr/esoria-codefest'
$TargetBranch = 'main'

function Invoke-Checked {
    param([string]$Label, [string]$Exe, [string[]]$Arguments)
    Write-Host "`n>>> $Label" -ForegroundColor Cyan
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label gagal (kode $LASTEXITCODE)." }
}
function Get-CheckedOutput {
    param([string]$Label, [string]$Exe, [string[]]$Arguments)
    $lines = @(& $Exe @Arguments)
    if ($LASTEXITCODE -ne 0) { throw "$Label gagal (kode $LASTEXITCODE)." }
    return (($lines -join "`n").Trim())
}
# Probe yang memang boleh gagal (remote belum ada / belum login / repo belum dibuat).
# Pada Windows PowerShell 5.1, stderr dari native app dapat menjadi NativeCommandError
# jika ErrorActionPreference=Stop. Probe dijalankan dengan Continue agar aman.
function Get-OptionalOutput {
    param([string]$Exe, [string[]]$Arguments)
    $old = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& $Exe @Arguments 2>$null)
        $ok = ($LASTEXITCODE -eq 0)
    } finally { $ErrorActionPreference = $old }
    if (-not $ok) { return $null }
    return (($lines -join "`n").Trim())
}
function Test-NativeSuccess {
    param([string]$Exe, [string[]]$Arguments)
    $old = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Exe @Arguments *> $null
        $ok = ($LASTEXITCODE -eq 0)
    } finally { $ErrorActionPreference = $old }
    return $ok
}
function Get-NormalizedRepoName {
    param([string]$Remote)
    $u = $Remote.Trim().TrimEnd('/')
    if ($u -match '^https://github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?$') {
        return "$($Matches[1])/$($Matches[2])".ToLowerInvariant()
    }
    if ($u -match '^git@github\.com:([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?$') {
        return "$($Matches[1])/$($Matches[2])".ToLowerInvariant()
    }
    if ($u -match '^ssh://git@github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?$') {
        return "$($Matches[1])/$($Matches[2])".ToLowerInvariant()
    }
    throw "Remote origin bukan URL github.com yang valid: $Remote"
}
function Get-RepositoryInfo {
    param([string]$Gh, [string]$Repo)
    $json = Get-OptionalOutput $Gh @('repo','view',$Repo,'--json','nameWithOwner,visibility,defaultBranchRef')
    if ($null -eq $json) { return $null }
    try { return ($json | ConvertFrom-Json) }
    catch { throw "Gagal membaca informasi repository $Repo dari GitHub CLI." }
}
function Audit-TrackedFiles {
    param([string]$Git)
    $files = @(& $Git -c core.quotepath=false ls-files --cached)
    if ($LASTEXITCODE -ne 0) { throw 'Gagal memeriksa daftar file untuk publikasi.' }
    $blocked = New-Object 'System.Collections.Generic.List[string]'
    $secretPattern = '(?i)-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{50,}|gh[pousr]_[A-Za-z0-9]{30,}|sk_live_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{20,}'
    $textPattern = '(?i)\.(?:js|mjs|cjs|ts|tsx|json|yml|yaml|md|txt|html|css|xml|rules|ps1|cmd|sh|py|toml|ini|properties)$'
    foreach ($file in $files) {
        $name = ($file -replace '\\','/').Trim()
        if ($name -match '(?i)(?:^|/)\.env\.(?:example|sample)$') { continue }
        if ($name -match '(?i)(?:^|/)(?:\.env(?:\.[^/]+)?|\.secret(?:\.[^/]+)?|\.firebase|\.git|node_modules)(?:/|$)' -or
            $name -match '(?i)(?:^|/)(?:service[-_]?account[^/]*\.json|credentials\.json|[^/]*private[-_]?key[^/]*|[^/]+\.(?:pem|p12|pfx|key|sqlite|db))$') {
            $blocked.Add("Nama file sensitif: $name")
            continue
        }
        $fullPath = Join-Path $Root ($file -replace '/', [IO.Path]::DirectorySeparatorChar)
        if (($name -match $textPattern) -and (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            $item = Get-Item -LiteralPath $fullPath
            if ($item.Length -le 2MB) {
                $value = [IO.File]::ReadAllText($item.FullName)
                if ($value -match $secretPattern) { $blocked.Add("Kemungkinan token/private key: $name") }
            }
        }
    }
    if ($blocked.Count -gt 0) {
        throw ("Upload PUBLIC dibatalkan karena file perlu ditinjau:`n- " + ($blocked -join "`n- "))
    }
    Write-Host "Audit file: $($files.Count) berkas terlacak; tidak ditemukan pola file/token berisiko tinggi." -ForegroundColor Green
    Write-Host 'Catatan: audit otomatis tidak menjamin tidak ada rahasia atau informasi pribadi.' -ForegroundColor Yellow
}

$exitCode = 1
Push-Location -LiteralPath $Root
try {
    Write-Host 'ESORIA CodeFest | GitHub SOURCE, bukan deploy Firebase' -ForegroundColor Cyan
    Write-Host "Folder: $Root"
    $gitCmd = Get-Command git.exe -ErrorAction SilentlyContinue
    if (-not $gitCmd) { $gitCmd = Get-Command git -ErrorAction SilentlyContinue }
    if (-not $gitCmd) { throw 'Git belum terpasang: https://git-scm.com/downloads/win' }
    $ghCmd = Get-Command gh.exe -ErrorAction SilentlyContinue
    if (-not $ghCmd) { $ghCmd = Get-Command gh -ErrorAction SilentlyContinue }
    if (-not $ghCmd) { throw 'GitHub CLI (gh) belum terpasang: https://cli.github.com/' }
    $Git = $gitCmd.Source
    $Gh = $ghCmd.Source

    if (-not (Test-NativeSuccess $Gh @('auth','status','--hostname','github.com'))) {
        Write-Host 'Login GitHub CLI diperlukan; lanjutkan login lewat browser.' -ForegroundColor Yellow
        Invoke-Checked 'Login GitHub' $Gh @('auth','login','--hostname','github.com','--git-protocol','https','--web')
    }
    Invoke-Checked 'Hubungkan kredensial GitHub CLI ke Git' $Gh @('auth','setup-git','--hostname','github.com')
    $login = Get-CheckedOutput 'Akun GitHub aktif' $Gh @('api','user','--jq','.login')
    if ($login -notmatch '^[A-Za-z0-9-]+$') { throw 'Nama akun GitHub tidak terbaca.' }
    Write-Host "Akun aktif: $login" -ForegroundColor Green

    if (-not [string]::IsNullOrWhiteSpace($env:ESORIA_GITHUB_REPO)) {
        $Target = $env:ESORIA_GITHUB_REPO.Trim()
        if ($Target -notmatch '/') { $Target = "$login/$Target" }
    }
    if ($Target -notmatch '^[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$') {
        throw 'Target tidak valid; gunakan ESORIA_GITHUB_REPO=owner/nama-repo.'
    }
    Write-Host "Tujuan PUBLIC: https://github.com/$Target (branch $TargetBranch)" -ForegroundColor Cyan

    $repoInfo = Get-RepositoryInfo $Gh $Target
    if ($null -eq $repoInfo) {
        Write-Host 'Repository belum dapat dibaca; mencoba membuat repository public baru.' -ForegroundColor Yellow
        Invoke-Checked 'Buat repository GitHub PUBLIC' $Gh @('repo','create',$Target,'--public','--description','Source code ESORIA CodeFest - Firebase web competition platform')
        $repoInfo = Get-RepositoryInfo $Gh $Target
        if ($null -eq $repoInfo) { throw 'Repository dibuat tetapi tidak dapat diverifikasi melalui GitHub.' }
    } else {
        Write-Host "Repository ditemukan: $($repoInfo.nameWithOwner) (visibility $($repoInfo.visibility))." -ForegroundColor Green
    }
    if ($repoInfo.nameWithOwner -ine $Target) {
        throw "GitHub mengembalikan repository $($repoInfo.nameWithOwner), bukan $Target."
    }

    $hasGit = Test-Path -LiteralPath (Join-Path $Root '.git')
    if (-not $hasGit) {
        Invoke-Checked 'Inisialisasi Git lokal, branch main' $Git @('init','-b',$TargetBranch)
    }
    $top = Get-CheckedOutput 'Periksa folder root repository' $Git @('rev-parse','--show-toplevel')
    if ([IO.Path]::GetFullPath($top).TrimEnd('\','/') -ine [IO.Path]::GetFullPath($Root).TrimEnd('\','/')) {
        throw 'Git repository lokal ternyata berada di folder induk, upload dibatalkan.'
    }
    $remoteNames = @(& $Git remote)
    if ($LASTEXITCODE -ne 0) { throw 'Tidak dapat membaca daftar Git remotes.' }
    if ($remoteNames -contains 'origin') {
        $originUrl = Get-CheckedOutput 'Baca remote origin' $Git @('remote','get-url','origin')
        $originRepo = Get-NormalizedRepoName $originUrl
        if ($originRepo -ine $Target.ToLowerInvariant()) {
            throw "Origin mengarah ke $originRepo, bukan $Target. Skrip tidak mengubah origin yang berbeda secara otomatis."
        }
        if ($originUrl -match '^(?:git@github\.com:|ssh://git@github\.com/)') {
            # Jika alamat sudah cocok tetapi memakai SSH, beralih ke HTTPS
            # supaya autentikasi gh auth setup-git dapat langsung dipakai.
            Invoke-Checked 'Gunakan HTTPS untuk origin yang sama' $Git @('remote','set-url','origin',"https://github.com/$Target.git")
            $originUrl = "https://github.com/$Target.git"
        }
        Write-Host "Remote origin cocok: $originUrl" -ForegroundColor Green
    } else {
        Invoke-Checked 'Tambahkan remote origin yang belum ada' $Git @('remote','add','origin',"https://github.com/$Target.git")
    }

    $branch = Get-OptionalOutput $Git @('branch','--show-current')
    if ([string]::IsNullOrWhiteSpace($branch)) { $branch = $TargetBranch }
    $hasCommit = Test-NativeSuccess $Git @('rev-parse','--verify','HEAD')
    if ($hasCommit -and $branch -ne $TargetBranch) {
        throw "Branch lokal aktif '$branch' bukan main. Ganti branch secara sadar sebelum upload."
    }
    if (-not $hasCommit -and $branch -ne $TargetBranch) {
        Invoke-Checked 'Gunakan branch lokal main' $Git @('symbolic-ref','HEAD','refs/heads/main')
    }

    $remoteHeads = Get-CheckedOutput 'Periksa branch pada repository GitHub' $Git @('ls-remote','--heads','origin')
    $remoteBranchNames = @()
    foreach ($line in ($remoteHeads -split "`r?`n")) {
        if ($line -match 'refs/heads/(.+)$') { $remoteBranchNames += $Matches[1] }
    }
    $isImporting = $false
    if (-not $hasCommit -and $remoteBranchNames.Count -gt 0) {
        # Solusi aman ketika repo sudah punya README/commit. Import commit lama,
        # pertahankan file remote yang tidak ada dalam ZIP, tanpa overwrite source ZIP.
        $base = if ($remoteBranchNames -contains 'main') { 'main' }
                elseif ($null -ne $repoInfo.defaultBranchRef -and $repoInfo.defaultBranchRef.name -in $remoteBranchNames) { $repoInfo.defaultBranchRef.name }
                else { throw 'Tidak dapat menemukan branch default remote secara aman; periksa repository GitHub.' }
        Write-Host "Repository GitHub sudah memiliki riwayat ($base): mengimpor tanpa force-push." -ForegroundColor Yellow
        Invoke-Checked 'Unduh riwayat remote' $Git @('fetch','--no-tags','origin',$base)
        Invoke-Checked 'Hubungkan commit lokal ke riwayat GitHub (file kerja tidak ditimpa)' $Git @('reset','--mixed','FETCH_HEAD')
        $isImporting = $true
    }

    $name = Get-OptionalOutput $Git @('config','--get','user.name')
    if ([string]::IsNullOrWhiteSpace($name)) {
        Invoke-Checked 'Atur nama Git hanya untuk folder ini' $Git @('config','user.name',$login)
    }
    $email = Get-OptionalOutput $Git @('config','--get','user.email')
    if ([string]::IsNullOrWhiteSpace($email)) {
        $accountId = Get-CheckedOutput 'Baca ID akun untuk alamat Git noreply' $Gh @('api','user','--jq','.id')
        if ($accountId -notmatch '^\d+$') { throw 'Tidak dapat menyiapkan identitas commit yang aman.' }
        Invoke-Checked 'Gunakan email noreply untuk commit lokal' $Git @('config','user.email',"$accountId+$login@users.noreply.github.com")
    }
    if ($isImporting) {
        # --ignore-removal menghindari penghapusan file lama yang hanya ada di GitHub.
        Invoke-Checked 'Tambahkan source ZIP tanpa menghapus file remote lain' $Git @('add','--ignore-removal','--','.')
        # Setelah staged, index memuat source ZIP. Restore worktree ke index hanya
        # memulihkan file remote yang hilang; perubahan source staged tidak ditimpa.
        Invoke-Checked 'Pulihkan file remote yang tidak ada dalam ZIP' $Git @('restore','--worktree','--','.')
    } else {
        Invoke-Checked 'Stage perubahan source sesuai .gitignore' $Git @('add','-A')
    }
    Audit-TrackedFiles $Git

    $diffCode = if (Test-NativeSuccess $Git @('diff','--cached','--quiet')) { 0 } else { 1 }
    if ($diffCode -eq 1) {
        Invoke-Checked 'Commit perubahan source ESORIA CodeFest' $Git @('commit','-m','chore: publish ESORIA CodeFest source')
    } else { Write-Host 'Tidak ada perubahan baru untuk di-commit.' -ForegroundColor Yellow }

    # Git non-force; jika remote berisi commit tambahan sesudah pemeriksaan, push
    # akan ditolak secara aman. Jalankan ulang setelah sinkronisasi manual.
    Invoke-Checked 'Push normal branch main ke GitHub' $Git @('push','-u','origin',$TargetBranch)

    $freshRepoInfo = Get-RepositoryInfo $Gh $Target
    if ($null -eq $freshRepoInfo) { throw 'Push selesai, tetapi informasi repository tidak dapat dibaca.' }
    if ($null -ne $freshRepoInfo.defaultBranchRef -and $freshRepoInfo.defaultBranchRef.name -ne $TargetBranch) {
        Invoke-Checked 'Jadikan main sebagai default branch' $Gh @('repo','edit',$Target,'--default-branch',$TargetBranch)
    }
    if (([string]$freshRepoInfo.visibility).ToUpperInvariant() -ne 'PUBLIC') {
        Write-Host 'Mengubah repository yang sudah ada menjadi PUBLIC sesuai permintaan pemilik.' -ForegroundColor Yellow
        Invoke-Checked 'Set repository GitHub PUBLIC' $Gh @('repo','edit',$Target,'--visibility','public','--accept-visibility-change-consequences')
    }
    $finalVisibility = Get-CheckedOutput 'Verifikasi visibilitas GitHub' $Gh @('repo','view',$Target,'--json','visibility','--jq','.visibility')
    if ($finalVisibility.ToUpperInvariant() -ne 'PUBLIC') {
        throw "Push selesai tetapi repo belum PUBLIC (GitHub melaporkan '$finalVisibility')."
    }
    $finalRemote = Get-CheckedOutput 'Verifikasi origin' $Git @('remote','get-url','origin')
    if ((Get-NormalizedRepoName $finalRemote) -ine $Target.ToLowerInvariant()) {
        throw 'Verifikasi akhir origin berbeda dari target.'
    }
    Write-Host "`nBERHASIL: https://github.com/$Target/tree/main" -ForegroundColor Green
    Write-Host 'STATUS: PUBLIC (dapat dilihat siapa saja). Firebase produksi tidak berubah.' -ForegroundColor Green
    $exitCode = 0
} catch {
    Write-Host "`nUPLOAD BERHENTI: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Tidak ada force-push, penghapusan repository, atau deploy Firebase.' -ForegroundColor Yellow
    Write-Host 'Jika GitHub/izin/jaringan bermasalah, baca pesan di atas dan jalankan ulang upload.cmd.' -ForegroundColor Yellow
} finally {
    Pop-Location
}
exit $exitCode
