const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const appKey = process.env.OMIE_APP_KEY;
const appSecret = process.env.OMIE_APP_SECRET;

async function testExibeTodosN() {
    const hoje = new Date().toLocaleDateString('pt-BR');
    const fullUrl = 'https://app.omie.com.br/api/v1/estoque/consulta/';
    
    try {
        console.log("Fetching first page with cExibeTodos: 'N'...");
        const start = Date.now();
        const { data } = await axios.post(fullUrl, {
            call: 'ListarPosEstoque',
            app_key: appKey,
            app_secret: appSecret,
            param: [{
                nPagina: 1,
                nRegPorPagina: 50,
                dDataPosicao: hoje,
                cExibeTodos: 'N',
            }],
        });
        const end = Date.now();
        console.log(`Fetch took ${(end - start) / 1000}s`);
        console.log(`nTotPaginas: ${data.nTotPaginas}`);
        console.log(`Total items on page 1: ${data.produtos.length}`);
        if (data.produtos.length > 0) {
            console.log(`First item saldo: ${data.produtos[0].nSaldo}`);
        }
    } catch (e) {
        console.error("Error:", e.response?.data || e.message);
    }
}

testExibeTodosN();
