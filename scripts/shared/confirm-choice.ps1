# PowerShell 5.1+ — konfirmasi sederhana, aman dan konsisten pada setiap tahap.
function Confirm-ESORIAYesNo {
    param([Parameter(Mandatory=$true)][string]$Prompt)
    while ($true) {
        $reply = [string](Read-Host "$Prompt [Y/N]")
        $reply = $reply.Trim().ToUpperInvariant()
        if ($reply -ceq 'Y') { return $true }
        if ($reply -ceq 'N') { return $false }
        Write-Host 'Masukkan Y untuk Iya atau N untuk Tidak.' -ForegroundColor Yellow
    }
}
