const axios = require('axios');

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
            console.warn(`[API Attempt ${attempt}/${maxRetries} Failed]: ${error.message}`);
            if (attempt < maxRetries) {
                console.log(`Waiting ${delayMs}ms before retrying...`);
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
        console.error('Errore irreversibile durante l\'autenticazione API:', error.response ? error.response.data : error.message);
        return null;
    }
}

/**
 * Funzione per aggiornare lo stato della PDA su Kiop
 * @param {string} idPda - L'ID della PDA da aggiornare
 * @param {string} accessToken - Il token di autenticazione Bearer
 * @param {string} dateText - La data da inserire (formato DD/MM/YYYY o YYYY-MM-DD)
 * @returns {Promise<boolean>} True se l'aggiornamento ha successo
 */
async function updatePdaStatus(idPda, accessToken, dateText) {
    try {
        const url = `https://pda.kiop.it/solida/api/automa/pda/${idPda}`;

        // Formatta la data da DD/MM/YYYY a YYYY-MM-DD se necessario
        let formattedDate = dateText;
        if (dateText && dateText.includes('/')) {
            const [day, month, year] = dateText.split('/');
            formattedDate = `${year}-${month}-${day}`;
        }

        const data = {
            stato: 20,
            microstato: '',
            dataInsMandataria: formattedDate
        };

        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await withRetry(() => axios.patch(url, data, config), 3, 2000);

        console.log(`[API SUCCESS]: PDA ${idPda} aggiornata (Stato 20, Data: ${formattedDate}).`);
        return true;
    } catch (error) {
        console.error(`[API ERROR]: Errore durante l'aggiornamento della PDA ${idPda}:`, error.response ? error.response.data : error.message);
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
    console.log(`\nIniziando il processo API per Account: ${accountName} (ID PDA: ${accountId})`);

    // 1. Ottieni il token
    const token = await getAuthToken();

    if (!token) {
        console.error(`Impossibile procedere per ${accountName}: token non ottenuto dopo i tentativi.`);
        return false;
    }

    // 2. Esegui la chiamata PATCH per aggiornare lo stato e la data
    const patchSuccess = await updatePdaStatus(accountId, token, dateText);

    if (patchSuccess) {
        console.log(`Flusso API completato con successo per ${accountName}.`);
        return true;
    } else {
        console.error(`Flusso API fallito nella fase di PATCH per ${accountName}.`);
        return false;
    }
}

module.exports = {
    processAcceptedRecord
};
