const fs = require('fs');
const path = require('path');
const { updateControlFromApi } = require('./update_control_from_api');
const { loginAndProcess } = require('./nav_to_login');
const logger = require('./logger');

const LOCK_FILE_PATH = path.join(__dirname, '..', 'app.lock');

function cleanupLock() {
    if (fs.existsSync(LOCK_FILE_PATH)) {
        try {
            fs.unlinkSync(LOCK_FILE_PATH);
            logger.info('File app.lock rimosso con successo.\n');
        } catch (e) {
            logger.error(`Impossibile rimuovere app.lock: ${e.message}`);
        }
    }
}

// Gestione segnali per rimuovere il lock se il processo viene interrotto (PM2, CTRL+C, ecc.)
process.on('SIGINT', () => { cleanupLock(); process.exit(0); });
process.on('SIGTERM', () => { cleanupLock(); process.exit(0); });
process.on('uncaughtException', (err) => {
    logger.error(`Errore non gestito: ${err.message}`);
    cleanupLock();
    process.exit(1);
});
process.on('exit', () => cleanupLock());

function printStatistics(resultsByProfile, durationMs) {
    logger.report(`\n=============================================================`);
    logger.report(`📊 STATISTICHE FINALI ESECUZIONE 📊`);
    logger.report(`=============================================================\n`);

    // Convert duration to minutes and seconds
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timeString = `${minutes}m ${seconds}s`;

    const profileNames = Object.keys(resultsByProfile);
    if (profileNames.length === 0) {
        logger.report(`Nessun record elaborato.`);
        logger.report(`Tempo totale: ${timeString}`);
        logger.report(`\n=============================================================\n`);
        return;
    }

    const globalStats = {
        totale: 0,
        inseriti: 0,
        erroriInvio: 0,
        nonTrovati: 0,
        perStato: {}
    };

    profileNames.forEach(name => {
        const results = resultsByProfile[name];
        const profileStats = {
            totale: results.length,
            inseriti: 0,
            erroriInvio: 0,
            nonTrovati: 0,
            perStato: {}
        };

        results.forEach(item => {
            const isInserita = item.inserita === 'si';
            const isNonTrovato = item.status === 'Non Trovato';

            const status = item.status || 'Sconosciuto';
            profileStats.perStato[status] = (profileStats.perStato[status] || 0) + 1;

            profileStats.inseriti += (isInserita ? 1 : 0);

            // Un errore di invio è reale solo se la pratica DOVEVA essere inserita (Accettata o Scaduta) ma non lo è stata
            if (!isInserita && (status === 'Accettata' || status === 'Scaduta')) {
                profileStats.erroriInvio++;
            }
            if (isNonTrovato) {
                profileStats.nonTrovati++;
            }

            // Aggiorna globali
            globalStats.totale++;
            globalStats.inseriti += (isInserita ? 1 : 0);
            if (!isInserita && (status === 'Accettata' || status === 'Scaduta')) {
                globalStats.erroriInvio++;
            }
            if (isNonTrovato) {
                globalStats.nonTrovati++;
            }
            globalStats.perStato[status] = (globalStats.perStato[status] || 0) + 1;
        });

        logger.report(`[ PROFILO: ${name} ]\n`);
        logger.report(`Totale PDA:           ${profileStats.totale}`);
        logger.report(`Totale Inserite:      ${profileStats.inseriti}`);

        if (profileStats.erroriInvio > 0) {
            logger.report(`⚠️  Errori Invio API:   ${profileStats.erroriInvio}`);
        }
        if (profileStats.nonTrovati > 0) {
            logger.report(`🔍 Record Non Trovati: ${profileStats.nonTrovati}`);
        }

        logger.report(`Dettaglio Stati:`);
        Object.keys(profileStats.perStato).sort().forEach(status => {
            logger.report(`  - ${status.padEnd(20)} ${profileStats.perStato[status]}`);
        });
        logger.report(`\n-------------------------------------------------------------\n`);
    });

    logger.report(`>> RIEPILOGO GENERALE <<<\n`);
    logger.report(`Tempo di esecuzione:         ${timeString}`);
    logger.report(`Totale Complessivo PDA:      ${globalStats.totale}`);
    logger.report(`Totale Complessivo Inserite: ${globalStats.inseriti}`);

    if (globalStats.erroriInvio > 0) {
        logger.report(`⚠️  Totale Errori Invio API:  ${globalStats.erroriInvio}`);
    }
    if (globalStats.nonTrovati > 0) {
        logger.report(`🔍 Totale Record Non Trovati: ${globalStats.nonTrovati}`);
    }

    logger.report(`Dettaglio Complessivo Stati:`);
    Object.keys(globalStats.perStato).sort().forEach(status => {
        logger.report(`- ${status.padEnd(22)} ${globalStats.perStato[status]}`);
    });

    logger.report(`\n=============================================================\n`);
}

async function main() {
    if (fs.existsSync(LOCK_FILE_PATH)) {
        const lockContent = fs.readFileSync(LOCK_FILE_PATH, 'utf8');
        const lockTime = new Date(lockContent).getTime();
        const now = Date.now();
        // Se il lock ha più di 2 ore (7200000 ms), forzalo come obsoleto
        if (now - lockTime > 7200000) {
            logger.report(`[LOCK] Trovato un vecchio file app.lock (più di 2 ore fa). Forzo l'eliminazione e procedo...`);
            cleanupLock();
        } else {
            logger.report(`[LOCK] Un'altra istanza è già in esecuzione! Rilevato il file app.lock creato il ${new Date(lockTime).toLocaleString('it-IT')}`);
            logger.report(`Se sei certo che si tratti di un errore bloccato, elimina manualmente il file ${LOCK_FILE_PATH}`);
            process.exit(1);
        }
    }

    // Crea il file di lock per prevenire esecuzioni multiple
    fs.writeFileSync(LOCK_FILE_PATH, new Date().toLocaleString('it-IT'), 'utf8');

    const startTime = Date.now();
    const configPath = path.join(__dirname, '..', 'config.json');
    if (!fs.existsSync(configPath)) {
        logger.error('config.json not found.');
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const profiles = config.profiles || [];
    const headless = config.headless !== undefined ? config.headless : false;

    if (profiles.length === 0) {
        logger.report('No profiles found in config.json.');
        return;
    }

    const now = new Date().toLocaleString('it-IT');
    logger.report(`\n=============================================================`);
    logger.report(`🚀 INIZIO AUTOMAZIONE PER ${profiles.length} PROFILI 🚀`);
    logger.report(`Data e Ora: ${now}`);
    logger.report(`[MODALITÀ HEADLESS: ${headless ? 'ATTIVA' : 'DISATTIVATA'}]`);
    logger.report(`=============================================================\n`);

    let resultsByProfile = {};
    let failedProfiles = [];
    const controlPath = path.join(__dirname, '..', 'control.json');

    for (const profile of profiles) {
        let success = true;
        try {
            // Step 1: Scaricare le PDA per questo profilo
            const count = await updateControlFromApi(profile);

            if (count > 0) {
                // Step 2: Eseguire l'automazione browser per questo profilo
                const processSuccess = await loginAndProcess(profile, headless);
                if (processSuccess === false) success = false;
            } else {
                logger.report(`[INFO] Nessuna PDA trovata per il profilo ${profile.name}. Salto lavorazione.`);
            }
        } catch (error) {
            logger.error(`[ERRORE CRITICO] Fallimento durante il profilo ${profile.name}: ${error.message}`);
            success = false;
        }

        if (!success) {
            failedProfiles.push(profile.name);
        }

        logger.log('-------------------------------------------------------------');

        // Accumula i risultati di questo profilo per le statistiche finali
        if (fs.existsSync(controlPath)) {
            try {
                const controlData = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
                if (controlData.results && Array.isArray(controlData.results)) {
                    resultsByProfile[profile.name] = controlData.results;
                }
            } catch (err) {
                logger.error(`[ERRORE] Impossibile leggere control.json per statistiche (${profile.name}): ${err.message}`);
            }
        }
    }

    const durationMs = Date.now() - startTime;
    printStatistics(resultsByProfile, durationMs);

    if (failedProfiles.length > 0) {
        logger.report(`❌ PROFILI FALLITI (Errore critico o Login):`);
        failedProfiles.forEach(p => logger.report(`  - ${p}`));
        logger.report(`\n=============================================================`);
    }

    logger.report(`\n=============================================================`);
    logger.report(`🎉 TUTTI I PROFILI SONO STATI ELABORATI 🎉`);
    logger.report(`=============================================================\n`);

    // Forza uscita pulita. Questo fa sì che l'evento process.on('exit') svuoti il file lock.
    process.exit(0);
}

main().catch(err => {
    logger.error(`Errore fatale nell'orchestratore: ${err.message}`);
    process.exit(1);
});

