@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title ESORIA CodeFest - Full Deploy Firebase
cls
echo ===========================================================
echo             ESORIA CODEFEST - FULL DEPLOY
echo ===========================================================
echo Project : esoria-codefest
echo Cakupan : Hosting, Cloud Functions, Firestore Rules/Indexes,
echo           Storage Rules, dan verifikasi administrator.
echo ===========================================================
echo.
set "RESULT=1"
if not exist "%~dp0scripts\live\START_LIVE.ps1" (
    echo ERROR: Skrip deployment tidak ditemukan. Ekstrak ZIP lengkap.
    goto :finish
)
where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo ERROR: Windows PowerShell 5.1 tidak ditemukan.
    goto :finish
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\live\START_LIVE.ps1"
set "RESULT=%ERRORLEVEL%"
if "%RESULT%"=="0" (
    echo.
    echo FULL DEPLOY SELESAI. Periksa website dan fitur penting di browser.
) else (
    echo.
    echo FULL DEPLOY BERHENTI dengan kode %RESULT%.
    echo Periksa pesan ERROR pertama pada terminal untuk mencari penyebabnya.
)
:finish
echo.
set /p "ESORIA_CLOSE=Tekan Enter untuk menutup jendela ini... "
exit /b %RESULT%
