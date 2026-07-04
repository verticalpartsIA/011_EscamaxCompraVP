const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const appKey = process.env.OMIE_APP_KEY;
const appSecret = process.env.OMIE_APP_SECRET;

async function testApiMeta() {
    const hoje = new Date().toLocaleDateString('pt-BR');
    const fullUrl = 'https://app.omie.com.br/api/v1/estoque/consulta/';
    
    try {
        const { data } = await axios.post(fullUrl, {
            call: 'ListarPosEstoque',
            app_key: appKey,
            app_secret: appSecret,
            param: [{
                nPagina: 1,
                nRegPorPagina: 50,
                dDataPosicao: hoje,
                cExibeTodos: 'S',
            }],
        });
        console.log(`nPagina: ${data.nPagina}`);
        console.log(`nTotPaginas: ${data.nTotPaginas}`);
        console.log(`nRegPorPagina: ${data.nRegPorPagina}`);
        console.log(`Total items on page: ${data.produtos.length}`);
    } catch (e) {
        console.error("Error:", e.response?.data || e.message);
    }
}

testApiMeta();
