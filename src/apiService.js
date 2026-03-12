const axios = require('axios');
const logger = require('./logger');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Funzione di utilità per eseguire una funzione (es. una chiamata Axios) con logica di retry
 * @param {Function} asyncFn - La funzione asincrona da eseguire
 * @param {number} maxRetries - Numero massimo di tentativi
 * @param {number} delayMs - Ritardo iniziale tra un tentativo e l'altro in ms (viene raddoppiato ad ogni tentativo)
 * @returns {Promise<any>} Il risultato della funzione
 */
async function withRetry(asyncFn, maxRetries = 3, delayMs = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await asyncFn();
        } catch (error) {
            lastError = error;
            logger.warn(`[API Attempt ${attempt}/${maxRetries} Failed]: ${error.message}`);
            if (attempt < maxRetries) {
                logger.log(`Waiting ${delayMs}ms before retrying...`);
                await wait(delayMs);
                delayMs *= 2; // Exponential backoff
            }
        }
    }
    throw lastError;
}

/**
 * Funzione per ottenere il token di autenticazione da Kiop
 * @returns {Promise<string|null>} L'access_token se la chiamata ha successo, altrimenti null
 */
async function getAuthToken() {
    try {
        const url = 'https://account.kiop.it/realms/maxel/protocol/openid-connect/token';

        // Per 'application/x-www-form-urlencoded' axios richiede un oggetto URLSearchParams
        const params = new URLSearchParams();
        params.append('grant_type', 'password');
        params.append('client_id', 'kiop-pda-dev');
        params.append('client_secret', 'd52f874a-4f99-4a16-ba94-c1fece71079a');
        params.append('username', 'superad@ivert.it');
        params.append('password', 'Super!AdS0p3r4d0!');
        params.append('scope', 'openid offline_access');

        // Usage of withRetry for the Axios call
        const response = await withRetry(() => axios.post(url, params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }), 3, 2000); // 3 attempts starting with 2s delay

        // La risposta standard OAuth2 contiene l'access_token qui:
        const token = response.data.access_token;
        return token;

    } catch (error) {
        logger.error(`Errore irreversibile durante l'autenticazione API: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
        return null;
    }
}

/**
 * Funzione per aggiornare lo stato della PDA su Kiop
 * @param {string} idPda - L'ID della PDA da aggiornare
 * @param {string} accessToken - Il token di autenticazione Bearer
 * @param {Object} updateData - Dati da aggiornare (stato, microstato, data opzionale)
 * @returns {Promise<boolean>} True se l'aggiornamento ha successo
 */
async function updatePdaStatus(idPda, accessToken, updateData) {
    try {
        const url = `https://pda.kiop.it/solida/api/automa/pda/${idPda}`;

        const data = {
            stato: updateData.stato,
            microstato: updateData.microstato || '',
            dataInsMandataria: updateData.data || null
        };

        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await withRetry(() => axios.patch(url, data, config), 3, 2000);

        logger.log(`[API SUCCESS]: PDA ${idPda} aggiornata (Stato ${data.stato}, Micro: '${data.microstato}').`);
        return true;
    } catch (error) {
        logger.error(`[API ERROR]: Errore durante l'aggiornamento della PDA ${idPda}: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
        return false;
    }
}

/**
 * Funzione principale che esegue il flusso API per un record accettato
 * @param {string} accountId - L'ID dell'account (es. 495077)
 * @param {string} accountName - Il nome dell'account (es. OP0015532403)
 * @param {string} dateText - La data estratta (es. 05/03/2026)
 */
async function processAcceptedRecord(accountId, accountName, dateText) {
    logger.log(`Iniziando il processo API per Account: ${accountName} (ID PDA: ${accountId})`);

    const token = await getAuthToken();
    if (!token) return false;

    // Formatta la data da DD/MM/YYYY a YYYY-MM-DD se necessario
    let formattedDate = dateText;
    if (dateText && dateText.includes('/')) {
        const [day, month, year] = dateText.split('/');
        formattedDate = `${year}-${month}-${day}`;
    }

    return await updatePdaStatus(accountId, token, {
        stato: 20,
        microstato: '',
        data: formattedDate
    });
}

/**
 * Crea un ticket KO su Kiop per una pratica scaduta
 * @param {string} idPda - L'ID della PDA
 * @param {string} accessToken - Il token di autenticazione Bearer
 * @param {string} groupId - L'ID del gruppo (es. '517228738')
 * @returns {Promise<boolean>} True se la creazione ha successo
 */
async function createKiopTicket(idPda, accessToken, groupId) {
    try {
        const url = `https://pda.kiop.it/solida/api/tickets/create/GenericPda/${idPda}?agentEmail=maxel%40ivert.it`;

        const data = {
            subject: "Pda esitata KO",
            description: "Pda esitata KO per firma non ricevuta",
            group: groupId
        };

        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await withRetry(() => axios.post(url, data, config), 3, 2000);

        logger.log(`[API SUCCESS]: Ticket creato per PDA ${idPda} (Group: ${groupId}).`);
        return true;
    } catch (error) {
        logger.error(`[API ERROR]: Errore durante la creazione del ticket per PDA ${idPda}: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
        return false;
    }
}

/**
 * Funzione principale per aggiornare una pratica scaduta su Kiop
 * @param {string} accountId - L'ID dell'account
 * @param {string} accountName - Il nome dell'account
 * @param {string} groupId - L'ID del gruppo
 */
async function processExpiredRecord(accountId, accountName, groupId) {
    logger.log(`Iniziando il processo API per Account SCADUTO: ${accountName} (ID PDA: ${accountId}, Group: ${groupId})`);

    const token = await getAuthToken();
    if (!token) return false;

    // 1. Aggiorna lo stato a Scaduta (1)
    const updateSuccess = await updatePdaStatus(accountId, token, {
        stato: 1,
        microstato: 'Firma non ricevuta',
        data: null
    });

    if (updateSuccess) {
        // 2. Crea il ticket KO con il groupId corretto
        await createKiopTicket(accountId, token, groupId);
        return true;
    }

    return false;
}

/**
 * Funzione per recuperare la lista delle PDA pendenti da Kiop.
 * @param {string} accessToken - Il token di autenticazione Bearer
 * @param {string} [groupId='517228738'] - ID per filtrare i record
 * @param {string} [microstatus='In attesa di firma'] - Microstato per filtrare i record
 * @param {string|number} [status='4'] - Stato per filtrare i record
 * @returns {Promise<Array|null>} La lista delle PDA se la chiamata ha successo
 */
async function fetchPendingRecords(accessToken, groupId = '517228738', microstatus = 'In attesa di firma', status = '4') {
    try {
        const baseUrl = 'https://pda.kiop.it/solida/api/pda/automa/list';
        const pageSize = 100;
        let allRecords = [];
        let page = 0;
        let totalCount = 0;

        do {
            const url = `${baseUrl}?size=${pageSize}&page=${page}` +
                `&groupId.in=${groupId}` +
                `&microstatus.equals=${encodeURIComponent(microstatus)}` +
                `&status.equals=${status}`;

            const config = {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json'
                }
            };

            const response = await withRetry(() => axios.get(url, config), 3, 2000);

            // Estrai il totale dalla response header al primo giro
            if (page === 0) {
                totalCount = parseInt(response.headers['x-total-count'] || '0', 10);
                logger.log(`[API]: Rilevato totale di ${totalCount} record da scaricare.`);
            }

            const pageRecords = Array.isArray(response.data) ? response.data : [];
            allRecords = allRecords.concat(pageRecords);

            logger.log(`[API]: Pagina ${page} scaricata (${pageRecords.length} record). Totale parziale: ${allRecords.length}/${totalCount}`);

            page++;
            // Condizione di uscita: abbiamo scaricato tutto o l'ultima pagina era vuota (fallback)
        } while (allRecords.length < totalCount && page < 50); // Hard limit di 50 pagine per sicurezza

        logger.log(`[API SUCCESS]: Recuperati complessivamente ${allRecords.length} record da Kiop.`);
        return allRecords;
    } catch (error) {
        logger.error(`[API ERROR]: Errore durante il recupero delle PDA: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
        return null;
    }
}

module.exports = {
    processAcceptedRecord,
    processExpiredRecord,
    fetchPendingRecords,
    getAuthToken
};
