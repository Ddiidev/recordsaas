@echo off

powershell -Command "Start-Process npm -ArgumentList 'run dev' -WindowStyle Hidden"
exit
