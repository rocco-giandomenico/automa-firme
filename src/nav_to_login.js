const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const apiService = require('./apiService');

/**
 * Automates navigation to the URL specified in config.json.
 */
async function run() {
    const configPath = path.join(__dirname, '..', 'config.json');

    if (!fs.existsSync(configPath)) {
        console.error('config.json not found in ' + __dirname);
        return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    if (!config.url) {
        console.error('URL not found in config.json');
        return;
    }

    console.log('Starting browser...');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`Navigating to ${config.url}...`);
    try {
        await page.goto(config.url, { waitUntil: 'networkidle' });
        console.log('Navigation successful.');

        // Wait for the login form to be loaded
        console.log('Waiting for login fields...');
        // The page uses Salesforce, common fields are input[type="text"] and input[type="password"]
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        console.log('Login fields detected.');

        let loggedIn = false;
        let attempts = 0;

        while (!loggedIn && attempts < 3) {
            attempts++;
            console.log(`Login attempt ${attempts}...`);
            await page.fill('input[type="text"]', config.username);
            await page.fill('input[type="password"]', config.password);

            console.log('Clicking login button...');
            await page.click('button.loginButton, button:has-text("Log in")');

            // Wait a bit for the action to process
            await page.waitForTimeout(5000);

            console.log('Checking page state...');

            // Check if session message is present
            const isSessionVisible = await page.isVisible('text=Utente con sessione attiva già presente a sistema').catch(() => false);

            if (isSessionVisible) {
                console.log('Detected concurrent session message.');
                console.log('Checking logout option...');
                // Select checkbox via associated text or input
                await page.click('text=Vuoi effettuare il log out da tutte le altre sessioni attive?', { force: true });
                await page.waitForTimeout(500);

                console.log('Clicking "Avanti"...');
                await page.click('button:has-text("Avanti")');
                await page.waitForTimeout(5000); // Wait for the session clear and redirect
                loggedIn = true; // Mark as logged in after Avanti
            } else {
                // Check if we are still on the login page (password field visible)
                const onLoginPage = await page.isVisible('input[type="password"]').catch(() => false);
                if (!onLoginPage) {
                    console.log('Login successful or moved away from login page.');
                    loggedIn = true;
                } else {
                    console.log('Still on login page. Retrying...');
                }
            }
        }

        // Se non siamo riusciti a fare login dopo 3 tentativi, interrompe tutto.
        if (!loggedIn) {
            console.error('\n=============================================================');
            console.error('❌ [ERRORE] LOGIN FALLITO! ❌');
            console.error('Impossibile effettuare il login dopo 3 tentativi.');
            console.error('Controlla che le credenziali in config.json siano corrette.');
            console.error('=============================================================\n');
            await browser.close();
            process.exit(1);
        }

        let homeUrl = config.url; // Fallback
        if (loggedIn) {
            homeUrl = page.url();
            console.log(`Home URL captured: ${homeUrl}`);
        }

        console.log('Automation process completed.');

        // 5. PROCESS CONTROL.JSON
        const controlPath = path.join(__dirname, '..', 'control.json');
        if (fs.existsSync(controlPath)) {
            const controlData = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
            console.log(`Starting processing for ${controlData.results.length} items...`);

            for (const item of controlData.results) {
                console.log(`--- Processing Account: ${item.account} (ID: ${item.id}) ---`);

                try {
                    // Wait for the search input to be available
                    const searchSelector = 'input[placeholder="Search..opportunityPage."]';
                    await page.waitForSelector(searchSelector, { timeout: 20000 });

                    console.log(`Searching for account: ${item.account}...`);

                    // Click to focus and clear the field
                    await page.click(searchSelector);
                    await page.fill(searchSelector, ''); // Clear existing text
                    await page.fill(searchSelector, item.account);

                    // Press Enter to start the search
                    await page.keyboard.press('Enter');

                    console.log('Search command sent. Waiting for results element...');

                    // 1. Wait for the specific result link to appear in the table
                    const resultLink = `a[title="${item.account}"]`;

                    try {
                        await page.waitForSelector(resultLink, { timeout: 15000 });
                        console.log('Result found. Extracting "Fase"...');
                    } catch (notFoundError) {
                        console.log(`>>> NESSUN RISULTATO: L'account ${item.account} non è stato trovato.`);
                        item.status = "Non Trovato";
                        item.date = "";
                        item.inserita = "no";
                        fs.writeFileSync(controlPath, JSON.stringify(controlData, null, 4));

                        // Torna alla home e salta al prossimo
                        console.log('Returning to Home page...');
                        await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                        continue;
                    }

                    // 2. Locate the "Fase" cell using the relationship with the account link
                    const faseLocator = page.locator(`tr:has(a[title="${item.account}"]) td:nth-child(3) span`);

                    // 3. Get text and log
                    const faseTesto = await faseLocator.innerText();
                    console.log(`>>> RISULTATO: L'account ${item.account} è in Fase: "${faseTesto}"`);

                    // 4. If status is "Accettata", click on the account link
                    if (faseTesto === "Accettata") {
                        console.log(`Status for ${item.account} is "Accettata". Clicking the link...`);
                        await page.locator(`tr:has(a[title="${item.account}"]) td:nth-child(1) a`).click();
                        // Wait for the new page to load
                        await page.waitForLoadState('domcontentloaded');
                        console.log('Opportunity detail page loaded.');

                        // 4.1. Extract the acceptance date
                        const dateLocatorSelector = 'div[data-target-selection-name="sfdc:RecordField.Opportunity.AcceptanceDate__c"] lightning-formatted-text';
                        await page.waitForSelector(dateLocatorSelector, { state: 'visible', timeout: 15000 });
                        const dateText = await page.locator(dateLocatorSelector).innerText();
                        item.date = dateText;
                        console.log(`>>> DATA ACCETTAZIONE TROVATA: ${dateText}`);

                        // 4.2 Call the API Service
                        const apiSuccess = await apiService.processAcceptedRecord(item.id, item.account, dateText);

                        if (apiSuccess) {
                            console.log(`API call success for ${item.account}. Setting inserita = 'si'`);
                            item.inserita = 'si';
                        } else {
                            console.error(`API call FAILED for ${item.account}. Left inserita = 'no'`);
                            item.inserita = 'no'; // Assicuriamoci che rimanga no se c'è un refuso pre-esistente
                        }
                    } else {
                        item.date = ""; // Reset or leave empty if not "Accettata"
                        // Per i record non "Accettata" 'inserita' non viene toccato o rimane 'no'
                    }

                    // 5. Update controlData and save to file
                    item.status = faseTesto;
                    fs.writeFileSync(controlPath, JSON.stringify(controlData, null, 4));
                    console.log(`Updated status and date for ${item.account} in control.json.`);

                    // 6. Return to the home page for the next account
                    console.log('Returning to Home page...');
                    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

                } catch (searchError) {
                    console.error(`Error with ${item.account}:`, searchError.message);
                    // Attempt to recover by reloading home URL
                    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
                }

                await page.waitForTimeout(3000); // Buffer between items
            }
            console.log('\n=============================================================');
            console.log('🎉 ELABORAZIONE COMPLETATA CON SUCCESSO! 🎉');
            console.log(`Tutti i ${controlData.results.length} record in control.json sono stati verificati e aggiornati.`);
            console.log('=============================================================\n');
        } else {
            console.log('control.json not found, skipping per-item loop.');
        }

    } catch (error) {
        console.error('Error during automation:', error.message);
    }

    // Close the browser automatically
    await browser.close();
}

run().catch(error => {
    console.error('Script failed:', error);
});
