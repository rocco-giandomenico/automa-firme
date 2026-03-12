const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const apiService = require('./apiService');
const logger = require('./logger');

/**
 * Automates navigation and processing for a given profile.
 * @param {Object} profile - The profile object containing name, url, username, password.
 * @param {boolean} headless - Whether to run the browser in headless mode.
 */
async function loginAndProcess(profile, headless = false) {
    if (!profile || !profile.url) {
        console.error('Invalid profile provided.');
        return;
    }

    logger.log(`>>> STARTING PROCESS FOR PROFILE: ${profile.name} <<<`);
    logger.log(`Starting browser (headless: ${headless})...`);
    const browser = await chromium.launch({ headless: headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    logger.log(`Navigating to ${profile.url}...`);
    try {
        await page.goto(profile.url, { waitUntil: 'networkidle' });
        logger.log('Navigation successful.');

        // Wait for the login form to be loaded
        logger.log('Waiting for login fields...');
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        logger.log('Login fields detected.');

        let loggedIn = false;
        let attempts = 0;

        while (!loggedIn && attempts < 3) {
            attempts++;
            logger.log(`Login attempt ${attempts}...`);
            await page.fill('input[type="text"]', profile.username);
            await page.fill('input[type="password"]', profile.password);

            logger.log('Clicking login button...');
            await page.click('button.loginButton, button:has-text("Log in")');

            // Wait a bit for the action to process
            await page.waitForTimeout(5000);

            logger.log('Checking page state...');

            // Check if session message is present
            const isSessionVisible = await page.isVisible('text=Utente con sessione attiva già presente a sistema').catch(() => false);

            if (isSessionVisible) {
                logger.log('Detected concurrent session message.');
                logger.log('Checking logout option...');
                await page.click('text=Vuoi effettuare il log out da tutte le altre sessioni attive?', { force: true });
                await page.waitForTimeout(500);

                logger.log('Clicking "Avanti"...');
                await page.click('button:has-text("Avanti")');
                await page.waitForTimeout(5000);
                loggedIn = true;
            } else {
                const onLoginPage = await page.isVisible('input[type="password"]').catch(() => false);
                if (!onLoginPage) {
                    logger.log('Login successful or moved away from login page.');
                    loggedIn = true;
                } else {
                    logger.log('Still on login page. Retrying...');
                }
            }
        }

        if (!loggedIn) {
            console.error('\n❌ [ERRORE] LOGIN FALLITO! ❌');
            console.error(`Impossibile effettuare il login per ${profile.name} dopo 3 tentativi.`);
            await browser.close();
            return false;
        }

        let homeUrl = profile.url;
        if (loggedIn) {
            homeUrl = page.url();
            logger.log(`Home URL captured: ${homeUrl}`);

            // Wait for the dashboard/home to be loaded
            logger.log('Waiting for page to initialize...');
            await page.waitForLoadState('load').catch(() => { });
            await page.waitForTimeout(3000);

            // PROCESS CONTROL.JSON
            const controlPath = path.join(__dirname, '..', 'control.json');
            if (fs.existsSync(controlPath)) {
                const controlData = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
                logger.log(`Starting processing for ${controlData.results.length} items...`);

                let isFirstItem = true;

                for (const item of controlData.results) {
                    logger.log(`--- Processing Account: ${item.account} (ID: ${item.id}) ---`);

                    try {
                        const searchSelector = 'input[placeholder="Search..opportunityPage."]';

                        if (isFirstItem) {
                            logger.log('Ensuring search bar is ready (first item)...');
                            await page.waitForSelector(searchSelector, { state: 'visible', timeout: 30000 });
                            await page.waitForTimeout(2000); // Additional safety for first search
                            isFirstItem = false;
                        } else {
                            await page.waitForSelector(searchSelector, { timeout: 20000 });
                        }

                        logger.log(`Searching for account: ${item.account}...`);
                        await page.click(searchSelector);
                        await page.fill(searchSelector, '');
                        await page.fill(searchSelector, item.account);
                        await page.keyboard.press('Enter');

                        const resultLink = `a[title="${item.account}"]`;

                        try {
                            await page.waitForSelector(resultLink, { timeout: 15000 });
                            logger.log('Result found. Extracting "Fase"...');
                        } catch (notFoundError) {
                            logger.log(`>>> NESSUN RISULTATO: L'account ${item.account} non è stato trovato.`);
                            item.status = "Non Trovato";
                            item.date = "";
                            item.inserita = "no";
                            fs.writeFileSync(controlPath, JSON.stringify(controlData, null, 4));
                            await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                            continue;
                        }

                        const faseLocator = page.locator(`tr:has(a[title="${item.account}"]) td:nth-child(3) span`);
                        const faseTesto = await faseLocator.innerText();
                        let finalStatus = faseTesto;
                        logger.log(`>>> RISULTATO: L'account ${item.account} è in Fase: "${faseTesto}"`);

                        logger.log(`Clicking the link for ${item.account}...`);
                        await page.locator(`tr:has(a[title="${item.account}"]) td:nth-child(1) a`).click();
                        await page.waitForLoadState('domcontentloaded');

                        if (faseTesto === "Accettata") {
                            const dateLocatorSelector = 'div[data-target-selection-name="sfdc:RecordField.Opportunity.AcceptanceDate__c"] lightning-formatted-text';
                            try {
                                await page.waitForSelector(dateLocatorSelector, { state: 'visible', timeout: 15000 });
                                const dateText = await page.locator(dateLocatorSelector).innerText();
                                item.date = dateText;
                                logger.log(`>>> DATA ACCETTAZIONE TROVATA: ${dateText}`);

                                const apiSuccess = await apiService.processAcceptedRecord(item.id, item.account, dateText);
                                item.inserita = apiSuccess ? 'si' : 'no';
                            } catch (e) {
                                logger.warn(`Data Accettazione non trovata per ${item.account}`);
                                item.date = "";
                            }
                        } else {
                            const deadlineSelector = 'div[data-target-selection-name="sfdc:RecordField.Opportunity.SelfAcceptanceDeadlineDate__c"] lightning-formatted-text';
                            try {
                                logger.log(`Searching for Deadline Date (Fase: ${faseTesto})...`);
                                await page.waitForSelector(deadlineSelector, { state: 'visible', timeout: 15000 });
                                const deadlineDate = await page.locator(deadlineSelector).innerText();
                                item.expiryDate = deadlineDate;
                                logger.log(`>>> DATA SCADENZA TROVATA: ${deadlineDate}`);

                                // Confronto con la data di oggi
                                if (deadlineDate && deadlineDate.includes('/')) {
                                    const [d, m, y] = deadlineDate.split('/').map(Number);
                                    const expiry = new Date(y, m - 1, d);
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0); // Azzera ore per confronto solo data

                                    if (expiry < today) {
                                        logger.log(`>>> ATTENZIONE: La pratica è scaduta (${deadlineDate})! Impostazione stato a Scaduta.`);
                                        finalStatus = "Scaduta";

                                        // Invio API per pratica scaduta usando il groupId del profilo
                                        const apiSuccess = await apiService.processExpiredRecord(item.id, item.account, profile.groupId);
                                        item.inserita = apiSuccess ? 'si' : 'no';
                                    }
                                }
                            } catch (e) {
                                logger.warn(`Data Scadenza non trovata per ${item.account}`);
                                item.expiryDate = "";
                            }
                            item.date = "";
                        }

                        item.status = finalStatus;
                        fs.writeFileSync(controlPath, JSON.stringify(controlData, null, 4));
                        await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

                    } catch (searchError) {
                        logger.error(`Error with ${item.account}: ${searchError.message}`);
                        await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
                    }
                    await page.waitForTimeout(2000);
                }
            }

        }
    } catch (error) {
        logger.error(`Error during automation for ${profile.name}: ${error.message}`);
    }

    await browser.close();
    logger.log(`>>> PROCESS COMPLETED FOR PROFILE: ${profile.name} <<<`);
    return true;
}

module.exports = { loginAndProcess };
