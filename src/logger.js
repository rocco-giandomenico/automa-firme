const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');

// Assicura che la cartella logs esista
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function getTimestamp() {
    return new Date().toLocaleString('it-IT', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
}

function getTodayLogFile() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    return path.join(logsDir, `${dateStr}.log`);
}

function getTodayReportFile() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    return path.join(logsDir, `report-${dateStr}.log`);
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
