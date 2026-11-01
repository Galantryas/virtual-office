@echo off
title 2D Virtual Dev Office & Sprint Manager
echo ==============================================================
echo   2D Pixel Art Virtual Dev Office & Sprint Manager
echo   Multi-Agent Autonomous Development Simulation
echo ==============================================================
echo.

:: 1. Prioritaskan Node.js (Asynchronous, non-blocking, paling cepat & stabil)
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Menggunakan runtime Node.js...
    start http://localhost:3000
    node server.js
    goto end
)

:: 2. Jika tidak ada Node.js, gunakan server.py (Multithreaded Python server)
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Menggunakan runtime Python (Threaded Server)...
    start http://localhost:3000
    python server.py
    goto end
)

:: 3. Fallback langsung membuka file index.html di browser
echo Menjalankan aplikasi langsung di browser default...
start index.html

:end
pause
