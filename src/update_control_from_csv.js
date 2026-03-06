const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function selectCsvFile(directory) {
    console.log('\n===================================================');
    console.log('[INFO] Seleziona il file CSV dalla finestra che si è aperta...');
    console.log('===================================================');

    const psScript = `
        Add-Type -AssemblyName System.Windows.Forms;
        $f = New-Object System.Windows.Forms.OpenFileDialog;
        $f.InitialDirectory = '${directory.replace(/\\/g, '\\\\')}';
        $f.Filter = 'File CSV (*.csv)|*.csv|Tutti i file (*.*)|*.*';
        $f.Title = 'Seleziona il file CSV degli account';
        $res = $f.ShowDialog();
        if ($res -eq 'OK') { Write-Output $f.FileName }
    `.replace(/\n/g, '').trim();

    try {
        const result = execSync(`powershell -NoProfile -sta -Command "${psScript}"`, { encoding: 'utf8' }).trim();
        if (!result) {
            console.error("\n[ERRORE] Nessun file selezionato. Operazione annullata.");
            process.exit(1);
        }
        console.log(`\nOK! Hai selezionato: ${result}`);
        return result;
    } catch (error) {
        console.error('[ERRORE] Impossibile aprire la finestra di selezione file.', error.message);
        process.exit(1);
    }
}

async function run() {
    const rootDir = path.join(__dirname, '..');
    const jsonPath = path.join(rootDir, 'control.json');

    // Lasciamo scegliere (o autoseleziona se c'è n'è solo uno) il file CSS dal prompt
    const csvPath = await selectCsvFile(rootDir);

    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.split('\n');
    const headers = lines[0].split(';');

    const idIndex = headers.indexOf('Id');
    const accountIndex = headers.indexOf('BO account');

    const results = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const columns = line.split(';');
        results.push({
            id: columns[idIndex] || "",
            account: columns[accountIndex] || "",
            status: 'pending',
            date: '',
            inserita: 'no'
        });
    }

    const finalJson = { results };

    fs.writeFileSync(jsonPath, JSON.stringify(finalJson, null, 4));
    console.log(`\nSuccessfully updated control.json with ${results.length} items from ${path.basename(csvPath)}.`);
}

run();
