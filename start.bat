@echo off
echo ===============================
echo   Personal Dashboard - STARTING
echo ===============================
pip install -r requirements.txt --quiet
echo.
echo Mo trinh duyet tai: http://localhost:8000
echo (Nhan Ctrl+C de dung)
echo.
python main.py
pause
