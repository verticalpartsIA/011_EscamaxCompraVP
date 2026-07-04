const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const omieClient = require('./services/omieClient');

async function debugStock() {
    try {
        console.log("--- DEBUG STOCK ---");
        const appKey = process.env.OMIE_APP_KEY;
        console.log(`App Key: ${appKey || 'NÃO ENCONTRADA'}`);

        console.log("Fetching all products with estoque > 0...");
        const start = Date.now();
        const results = await omieClient.listarTodos();
        const end = Date.now();
        console.log(`Fetch took ${(end - start) / 1000}s`);
        console.log(`Total results: ${results.length}`);

        if (results.length > 0) {
            console.log("Sample results (first 5):");
            results.slice(0, 5).forEach(p => {
                console.log(`- ${p.codigo}: ${p.descricao} (Estoque: ${p.saldo_estoque})`);
            });
        }
    } catch (e) {
        console.error("Error:", e.message);
        if (e.stack) console.error(e.stack);
    }
}

debugStock();
