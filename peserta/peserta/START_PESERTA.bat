@echo off
title AKWIR POSIND v3 - PESERTA
cd /d "%~dp0peserta"
echo ================================================
echo       AKWIR POSIND v3 - APLIKASI PESERTA
echo ================================================
echo Server peserta: http://127.0.0.1:8000/index.html
echo Jangan tutup jendela ini selama aplikasi digunakan.
echo.
start "" "http://127.0.0.1:8000/index.html"
python -m http.server 8000 --bind 127.0.0.1
pause
