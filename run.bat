@echo off
echo ===================================================
echo 0. SELEZIONE ACCOUNT...
echo ===================================================
node src\select_profile.js
if %errorlevel% neq 0 (
    exit /b %errorlevel%
)

echo.
echo ===================================================
echo 1. AGGIORNAMENTO CONTROL.JSON DA CSV...
echo ===================================================
node src\update_control_from_csv.js
if %errorlevel% neq 0 (
    echo [ERRORE] L'aggiornamento del file control.json e' fallito!
    exit /b %errorlevel%
)

echo.
echo ===================================================
echo 2. AVVIO AUTOMAZIONE BROWSER...
echo ===================================================
node src\nav_to_login.js
if %errorlevel% neq 0 (
    echo [ERRORE] L'automazione browser e' fallita o e' stata interrotta!
    pause
    exit /b %errorlevel%
)

echo.
echo ===================================================
echo PROCESSO COMPLETATO!
echo ===================================================
pause
