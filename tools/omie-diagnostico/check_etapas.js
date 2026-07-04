const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, 'server/.env') });
const axios = require('axios');

async function main() {
    const key = process.env.OMIE_APP_KEY;
    const secret = process.env.OMIE_APP_SECRET;
    console.log(`Usando APP_KEY: ${key ? key.substring(0, 6) + '...' : 'NÃO ENCONTRADA'}`);

    const { data } = await axios.post('https://app.omie.com.br/api/v1/produtos/pedido/', {
        call: 'ListarEtapas',
        app_key: key,
        app_secret: secret,
        param: [{}]
    }, { headers: { 'Content-Type': 'application/json' } });

    console.log('\n=== ETAPAS DISPONÍVEIS NA VP ===');
    const etapas = data.etapas || data.cadastros || data || [];
    if (Array.isArray(etapas)) {
        etapas.forEach(e => console.log(`  Código: ${e.cCodigo || e.codigo || e.cEtapa || JSON.stringify(e)}`));
    } else {
        console.log(JSON.stringify(data, null, 2));
    }
}

main().catch(e => {
    console.error('Erro:', e.response?.data || e.message);
});
