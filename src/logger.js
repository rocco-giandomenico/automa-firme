const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');

// Assicura che la cartella logs esista
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function getTimestamp() {
    return new Date().toISOString();
}

function getTodayLogFile() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(logsDir, `${today}.log`);
}

function getTodayReportFile() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(logsDir, `report-${today}.log`);
}

function writeToFile(level, message) {
    const timestamp = getTimestamp();
    const logFile = getTodayLogFile();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    try {
        fs.appendFileSync(logFile, logMessage);
    } catch (err) {
        console.error('Errore durante la scrittura sul file di log:', err.message);
    }
}

function writeToReportFile(message) {
    const reportFile = getTodayReportFile();
    try {
        fs.appendFileSync(reportFile, `${message}\n`);
    } catch (err) {
        console.error('Errore durante la scrittura sul file di report:', err.message);
    }
}

const logger = {
    log: (message) => {
        console.log(message);
        writeToFile('INFO', message);
    },
    info: (message) => {
        console.log(`[INFO] ${message}`);
        writeToFile('INFO', message);
    },
    warn: (message) => {
        console.warn(`[WARN] ${message}`);
        writeToFile('WARN', message);
    },
    error: (message) => {
        console.error(`[ERROR] ${message}`);
        writeToFile('ERROR', message);
    },
    report: (message) => {
        console.log(message);
        writeToReportFile(message);
    }
};

module.exports = logger;
