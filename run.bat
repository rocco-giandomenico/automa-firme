@echo off
echo ===================================================
echo AVVIO CICLO PROFILI DEFINITI IN config.json
echo ===================================================
node src\execute_all_profiles.js
if %errorlevel% neq 0 (
    echo [ERRORE] L'esecuzione del ciclo profili e' fallita!
    pause
    exit /b %errorlevel%
)
echo.
echo ===================================================
echo PROCESSO COMPLETATO PER TUTTI I PROFILI!
echo ===================================================
pause
