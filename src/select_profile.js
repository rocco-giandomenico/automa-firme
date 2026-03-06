const fs = require('fs');
const readline = require('readline');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');

if (!fs.existsSync(configPath)) {
    console.error(`[ERRORE] File config.json non trovato.`);
    process.exit(1);
}

let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (!config.profiles || config.profiles.length === 0) {
    console.warn("[AVVISO] Nessuna lista 'profiles' trovata in config.json. Utilizzo le credenziali di default.");
    console.log(`Username in uso: ${config.username}`);
    process.exit(0);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("\n===================================================");
console.log("   S E L E Z I O N A   A C C O U N T");
console.log("===================================================");
config.profiles.forEach((p, idx) => {
    console.log(`  [${idx + 1}] ${p.name || 'Account'} (${p.username})`);
});
console.log("===================================================\n");

rl.question('>> Digita il numero dell\'account da usare e premi Invio (es. 1): ', (answer) => {
    const choice = parseInt(answer.trim(), 10);

    if (isNaN(choice) || choice < 1 || choice > config.profiles.length) {
        console.error("\n[ERRORE] Scelta non valida o annullata. Riprova.");
        rl.close();
        process.exit(1);
    }

    // Aggiorna i dati principali di config.json con quelli selezionati
    const selectedProfile = config.profiles[choice - 1];
    config.url = selectedProfile.url || config.url;
    config.username = selectedProfile.username;
    config.password = selectedProfile.password;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

    console.log(`\nOK! Hai selezionato: ${selectedProfile.name || config.username}`);
    console.log(`Email in uso: ${config.username}`);
    rl.close();
    process.exit(0);
});
