const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const appKey = process.env.OMIE_APP_KEY;
const appSecret = process.env.OMIE_APP_SECRET;

async function testApiStock(date) {
    const fullUrl = 'https://app.omie.com.br/api/v1/estoque/consulta/';
    
    try {
        let nPagina = 1;
        let countPos = 0;
        let totalItemsWithStock = 0;
        
        // Let's only check first 5 pages for speed
        do {
            const { data } = await axios.post(fullUrl, {
                call: 'ListarPosEstoque',
                app_key: appKey,
                app_secret: appSecret,
                param: [{
                    nPagina: nPagina,
                    nRegPorPagina: 50,
                    dDataPosicao: date,
                    cExibeTodos: 'S',
                }],
            });
            
            const items = data.produtos || [];
            countPos += items.length;
            totalItemsWithStock += items.filter(i => (i.nSaldo || 0) > 0).length;
            
            if (nPagina >= 5 || nPagina >= data.nTotPaginas) break;
            nPagina++;
        } while (true);
        
        console.log(`Results for ${date}:`);
        console.log(`- Pages checked: ${nPagina}`);
        console.log(`- Total items found: ${countPos}`);
        console.log(`- Items with stock > 0 in those pages: ${totalItemsWithStock}`);
        
    } catch (e) {
        console.error("Error:", e.response?.data || e.message);
    }
}

async function runTests() {
    console.log("--- COMPARING DATES ---");
    await testApiStock('21/03/2026'); // Today (Sat)
    await testApiStock('20/03/2026'); // Yesterday (Fri)
}

runTests();
