@echo off
echo ===================================================
echo AVVIO AUTOMA TRAMITE PM2 (ecosystem.config.js)
echo ===================================================

echo.
echo [1/4] Mi assicuro che PM2 NON sia in esecuzione automatica all'avvio...
call pm2 unstartup >nul 2>&1

echo.
echo [2/4] Elimino tutti i servizi PM2 esistenti e il file di lock...
call pm2 delete all >nul 2>&1
if exist app.lock del app.lock

echo.
echo [3/4] Avvio/Aggiorno i processi dall'ecosystem.config.js...
call pm2 start ecosystem.config.js

echo.
echo [4/4] Salvo lo stato attuale di PM2...
call pm2 save

echo.
echo ===================================================
echo PROCESSO PM2 AVVIATO CON SUCCESSO!
echo ===================================================
echo Puoi chiudere questa finestra. L'automa continuera' in background.
echo Per vedere i log digita: pm2 logs automa-firme
echo.
pause
