#requires -Version 5.1
<#
Enable Node.js v22.22.2 ONLY for the current PowerShell process and its children.
Do not uninstall or alter the system-installed Node.js 24.
Downloads only from nodejs.org over HTTPS and verifies SHA256 against official SHASUMS256.txt.
No Firebase changes and no production writes.
#>
function Enable-ESORIA_Node22 {
    [CmdletBinding()]
    param([switch]$NoDownload)
    $Version = 'v22.22.2'
    $Release = $Version.TrimStart('v')

    try {
        $active = (& node.exe --version 2>$null | Out-String).Trim()
    } catch { $active = '' }
    if ($active -match '^v22\.') {
        Write-Host "Node.js 22 sudah aktif: $active" -ForegroundColor Green
        if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
            throw 'npm.cmd belum ditemukan. Instal Node.js 22 lengkap dengan npm.'
        }
        return
    }

    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'LOCALAPPDATA tidak ditemukan. Periksa profil pengguna Windows.'
    }
    $Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $FolderName = "node-$Version-win-$Arch"
    $NodeRoot = Join-Path $env:LOCALAPPDATA 'ESORIA_Node22'
    $NodeFolder = Join-Path $NodeRoot $FolderName
    $NodeExe = Join-Path $NodeFolder 'node.exe'
    $NpmCmd = Join-Path $NodeFolder 'npm.cmd'

    # A cached portable Node is only trusted when its version matches the pinned release.
    $cachedVersion = ''
    if (Test-Path -LiteralPath $NodeExe -PathType Leaf) {
        try { $cachedVersion = (& $NodeExe --version | Out-String).Trim() } catch { }
    }
    if ($cachedVersion -cne $Version -or -not (Test-Path -LiteralPath $NpmCmd -PathType Leaf)) {
        if ($NoDownload) { throw "Node.js $Version portable belum tersedia di $NodeFolder" }
        Write-Host "Node.js yang terdeteksi: $active. Menyiapkan Node.js $Version portable khusus ESORIA." -ForegroundColor Yellow
        Write-Host 'Node.js sistem Anda tidak akan dihapus atau diganti.' -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $NodeRoot -Force | Out-Null
        $Tmp = Join-Path $NodeRoot ('download-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
        $ZipName = "$FolderName.zip"
        $Archive = Join-Path $Tmp $ZipName
        $Checksums = Join-Path $Tmp 'SHASUMS256.txt'
        $Base = "https://nodejs.org/dist/$Version"
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri "$Base/SHASUMS256.txt" -OutFile $Checksums -UseBasicParsing -ErrorAction Stop
            Invoke-WebRequest -Uri "$Base/$ZipName" -OutFile $Archive -UseBasicParsing -ErrorAction Stop
            $Exact = '^([0-9a-fA-F]{64})\s+' + [regex]::Escape($ZipName) + '$'
            $Match = Get-Content -LiteralPath $Checksums | Where-Object { $_ -match $Exact } | Select-Object -First 1
            if (-not $Match) { throw 'Checksum resmi untuk arsip Node.js tidak ditemukan.' }
            $Expected = [regex]::Match($Match, $Exact).Groups[1].Value.ToUpperInvariant()
            $Actual = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToUpperInvariant()
            if ($Actual -cne $Expected) { throw 'SHA256 tidak cocok. Arsip Node.js dibatalkan demi keamanan.' }
            Write-Host 'Checksum SHA256 Node.js resmi sudah cocok.' -ForegroundColor Green
            Expand-Archive -LiteralPath $Archive -DestinationPath $NodeRoot -Force -ErrorAction Stop
        } finally {
            Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf) -or -not (Test-Path -LiteralPath $NpmCmd -PathType Leaf)) {
        throw 'Node.js portable tidak lengkap seusai ekstraksi.'
    }
    $portableVersion = (& $NodeExe --version | Out-String).Trim()
    if ($portableVersion -cne $Version) { throw "Versi Node.js portable tidak sesuai: $portableVersion" }
    $env:Path = $NodeFolder + [IO.Path]::PathSeparator + $env:Path
    $finalVersion = (& node.exe --version | Out-String).Trim()
    if ($finalVersion -notmatch '^v22\.') { throw "Gagal mengaktifkan Node.js 22 dalam proses ini: $finalVersion" }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm tidak ditemukan setelah Node.js portable disiapkan.' }
    Write-Host "Node.js khusus ESORIA aktif: $finalVersion" -ForegroundColor Green
}
