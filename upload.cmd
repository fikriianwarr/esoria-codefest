@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title ESORIA CodeFest - Upload Github PUBLIC
cls
echo ===========================================================
echo          ESORIA CODEFEST - GITHUB UPLOAD PUBLIC
echo ===========================================================
echo Fungsi : Commit dan push SOURCE CODE ke GitHub.
echo Bukan  : Deploy Firebase / mengubah database produksi.
echo Target : fikriianwarr/esoria-codefest ^(PUBLIC^), branch main.
echo ===========================================================
echo.
set "ESORIA_UPLOAD_RESULT=1"
if not exist "%~dp0scripts\github-upload.ps1" (
    echo ERROR: scripts\github-upload.ps1 tidak ditemukan.
    echo Ekstrak seluruh isi ZIP ke satu folder terlebih dahulu.
    goto :finish
)
where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo ERROR: Windows PowerShell 5.1 tidak ditemukan.
    goto :finish
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\github-upload.ps1"
set "ESORIA_UPLOAD_RESULT=%ERRORLEVEL%"
if "%ESORIA_UPLOAD_RESULT%"=="0" (
    echo.
    echo BERHASIL: Source code diunggah ke repository GitHub PUBLIC.
    echo URL repository tercetak pada baris BERHASIL di atas.
) else (
    echo.
    echo GAGAL: Upload berhenti dengan kode %ESORIA_UPLOAD_RESULT%.
    echo Periksa pesan ERROR di atas. Tidak ada force-push atau deploy Firebase.
)
:finish
echo.
set /p "ESORIA_UPLOAD_EXIT=Tekan Enter untuk menutup jendela ini... "
exit /b %ESORIA_UPLOAD_RESULT%
