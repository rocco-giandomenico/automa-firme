const fs = require('fs');
const path = require('path');
const apiService = require('./apiService');
const logger = require('./logger');

/**
 * Fetches PDA records from Kiop API for a specific profile and updates control.json.
 * @param {Object} profile - The profile object containing groupId, etc.
 * @returns {Promise<number>} The number of records processed.
 */
async function updateControlFromApi(profile) {
    const rootDir = path.join(__dirname, '..');
    const jsonPath = path.join(rootDir, 'control.json');

    logger.report(`\n[API] Recupero PDA per profilo: ${profile.name}...`);

    try {
        const token = await apiService.getAuthToken();
        if (!token) throw new Error('Impossibile ottenere il token API.');

        // Use filters from profile
        const pdas = await apiService.fetchPendingRecords(
            token, 
            profile.groupId, 
            profile.microstatus, 
            profile.status
        );

        if (!pdas) throw new Error('Impossibile recuperare la lista delle PDA.');

        logger.log(`[API] Ricevuti ${pdas.length} record.`);

        const results = pdas.map(record => {
            // Mapping flessibile per diversi formati di risposta API
            const id = record.id || (record.account ? record.account.id : "");
            const account = (record.backOffice && record.backOffice.account) || 
                            (record.account && record.account.name) || 
                            "N/D";

            return {
                id: String(id),
                account: account,
                status: 'pending',
                date: '',
                expiryDate: '',
                inserita: 'no'
            };
        });

        const finalJson = { results };
        fs.writeFileSync(jsonPath, JSON.stringify(finalJson, null, 4));

        logger.report(`[API] control.json aggiornato con ${results.length} elementi per il profilo ${profile.name}`);

        return results.length;
    } catch (error) {
        logger.error(`[API ERROR] Profilo ${profile.name}: ${error.message}`);
        throw error;
    }
}

module.exports = { updateControlFromApi };

