#requires -Version 5.1
<# Only changes local source. NEVER deploys or modifies Firebase. #>
[CmdletBinding()]
param([switch]$Enable)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $Enable) { throw 'Gunakan -Enable hanya SETELAH seluruh admin selesai enrollment dan uji recovery di staging.' }
Write-Host 'Script ini mengaktifkan MFA pada source lokal (belum deploy).' -ForegroundColor Yellow
Write-Host 'JANGAN aktifkan bila satu saja admin produksi belum mendaftarkan faktor kedua dan belum diuji.' -ForegroundColor Yellow
. (Join-Path $PSScriptRoot 'shared/confirm-choice.ps1')
# SEMUA ADMIN SIAP wajib diverifikasi di staging; operator cukup memilih Y atau N.
if (-not (Confirm-ESORIAYesNo 'Semua admin sudah mendaftarkan MFA dan menguji pemulihan di staging? Aktifkan aturan pada source lokal?')) {
    throw 'Dibatalkan, tidak ada perubahan.'
}
$envPath = Join-Path $Root 'functions/.env.esoria-codefest'
$old = Get-Content -LiteralPath $envPath -Raw
if ($old -notmatch '(?m)^REQUIRE_ADMIN_MFA=false[ \t]*$' -or $old -notmatch '(?m)^REQUIRE_RECENT_ADMIN_AUTH=false[ \t]*$') {
    throw 'Flag MFA tidak berada pada status staged yang diharapkan. Periksa manual.'
}
foreach ($rule in @('firestore.rules','storage.rules')) {
    $variant = Join-Path $Root ($rule + '.mfa-enforced')
    if (-not (Test-Path -LiteralPath $variant -PathType Leaf)) { throw "Varian rule hilang: $variant" }
}
$old = $old -replace '(?m)^REQUIRE_ADMIN_MFA=false[ \t]*$', 'REQUIRE_ADMIN_MFA=true'
$old = $old -replace '(?m)^REQUIRE_RECENT_ADMIN_AUTH=false[ \t]*$', 'REQUIRE_RECENT_ADMIN_AUTH=true'
# Preserve original source rules as local rollback reference (not a backup of live data).
foreach ($rule in @('firestore.rules','storage.rules')) {
    Copy-Item -LiteralPath (Join-Path $Root $rule) -Destination (Join-Path $Root ($rule + '.pre-mfa')) -Force
    Copy-Item -LiteralPath (Join-Path $Root ($rule + '.mfa-enforced')) -Destination (Join-Path $Root $rule) -Force
}
[System.IO.File]::WriteAllText($envPath, $old, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Source MFA aktif. Jalankan seluruh tes + Emulator dan uji akses admin sebelum setuju deployment.' -ForegroundColor Green
