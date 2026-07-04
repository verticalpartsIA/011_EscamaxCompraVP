/**
 * Testa etapas na conta VP do Omie e salva resultado em JSON
 */
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '.env') });

const axios = require('axios');
const fs = require('fs');

const APP_KEY = process.env.OMIE_APP_KEY;
const APP_SECRET = process.env.OMIE_APP_SECRET;

async function omiePost(call, param) {
    const { data } = await axios.post('https://app.omie.com.br/api/v1/produtos/pedido/', {
        call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param]
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 60000 });
    return data;
}

async function main() {
    const results = [];

    // Test each Omie API-valid etapa
    const etapas = ['10', '20', '30', '40', '50', '70', '80'];
    for (const etapa of etapas) {
        try {
            const data = await omiePost('IncluirPedido', {
                cabecalho: {
                    codigo_pedido_integracao: `TEST-${etapa}-${Date.now()}`,
                    codigo_cliente: 999999999,
                    data_previsao: '05/03/2026',
                    etapa,
                    codigo_parcela: '999',
                },
                det: [],
                informacoes_adicionais: {
                    codigo_categoria: '1.01.01',
                    codigo_conta_corrente: 0,
                    consumidor_final: 'N',
                    enviar_email: 'N',
                },
            });
            results.push({ etapa, accepted: true, reason: 'SUCCESS', raw: data });
        } catch (err) {
            const faultstring = err.response?.data?.faultstring || err.message || '';
            const isEtapaBad =
                faultstring.includes('nao disponivel') ||
                faultstring.includes('nao permitida') ||
                // Portuguese with accent
                (faultstring.indexOf('disponível') > -1 && faultstring.indexOf('tapa') > -1) ||
                (faultstring.indexOf('permitida') > -1 && faultstring.indexOf('tapa') > -1);
            results.push({
                etapa,
                accepted: !isEtapaBad,
                reason: faultstring.substring(0, 120),
                isEtapaBad,
            });
        }
        await new Promise(r => setTimeout(r, 500));
    }

    fs.writeFileSync(path.resolve(__dirname, 'etapa_test_results.json'), JSON.stringify(results, null, 2));
    console.log('Done. Results written to etapa_test_results.json');
}

main().catch(e => {
    console.error('FATAL:', e.message);
    process.exit(1);
});
