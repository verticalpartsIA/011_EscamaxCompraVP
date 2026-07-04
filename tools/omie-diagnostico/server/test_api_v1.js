const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const appKey = process.env.OMIE_APP_KEY;
const appSecret = process.env.OMIE_APP_SECRET;

async function testApi() {
    const hoje = new Date().toLocaleDateString('pt-BR');
    const fullUrl = 'https://app.omie.com.br/api/v1/estoque/consulta/';
    
    console.log(`Testing with App Key: ${appKey}`);
    try {
        const { data } = await axios.post(fullUrl, {
            call: 'ListarPosEstoque',
            app_key: appKey,
            app_secret: appSecret,
            param: [{
                nPagina: 1,
                nRegPorPagina: 5,
                dDataPosicao: hoje,
                cExibeTodos: 'S',
            }],
        });
        console.log("Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Error:", e.response?.data || e.message);
    }
}

testApi();
