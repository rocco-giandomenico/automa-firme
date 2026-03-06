const fs = require('fs');
const path = require('path');

// Legge gli argomenti passati da terminale
const args = process.argv.slice(2);

if (args.length < 2) {
    console.log("Uso corretto: node set_config.js <username> <password> [url(opzionale)]");
    console.log("Esempio: node set_config.js mario.rossi@azienda.it Password123!");
    process.exit(1);
}

const configPath = path.join(__dirname, '..', 'config.json');
let config = {
    // Valori di default precauzionali se il file non esiste
    url: "https://a2aenergia.my.site.com/a2apartner/s/login/"
};

// Se config.json esiste, preserva i vecchi dati sovrascrivendo solo quelli nuovi
if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

config.username = args[0];
config.password = args[1];

// Modifica l'URL solo se è stato passato come terzo parametro
if (args[2]) {
    config.url = args[2];
}

// Salva le modifiche
fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

console.log("\n==============================================");
console.log("DATI DI ACCESSO AGGIORNATI CON SUCCESSO!");
console.log(`Username: ${config.username}`);
console.log(`Password: [Nascosta per sicurezza]`);
console.log(`URL:      ${config.url}`);
console.log("==============================================\n");
