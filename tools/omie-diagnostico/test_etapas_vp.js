/**
 * Testa quais etapas são aceitas pela conta VP do Omie.
 * Usa um código de cliente inválido propositalmente — se o erro for sobre
 * cliente (e não sobre etapa), significa que a etapa foi aceita.
 */
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, 'server/.env') });

// Use axios from server/node_modules
const axios = require(path.resolve(__dirname, 'server/node_modules/axios'));
const APP_KEY = process.env.OMIE_APP_KEY;
const APP_SECRET = process.env.OMIE_APP_SECRET;

async function testEtapa(etapa) {
    try {
        const { data } = await axios.post(
            'https://app.omie.com.br/api/v1/produtos/pedido/',
            {
                call: 'IncluirPedido',
                app_key: APP_KEY,
                app_secret: APP_SECRET,
                param: [{
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
                    }
                }]
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: 60000 }
        );
        return { etapa, status: 'ACEITA (sucesso!)', raw: data };
    } catch (err) {
        const fs = err.response?.data?.faultstring || err.message || '';
        const isEtapaBad =
            fs.includes('nao disponivel') ||
            fs.includes('não disponível') ||
            fs.includes('não permitida') ||
            fs.toLowerCase().includes('etapa');
        return {
            etapa,
            status: isEtapaBad ? 'REJEITADA (etapa inválida)' : 'ACEITA (erro outro: ' + fs.substring(0, 80) + ')',
            rejected: isEtapaBad
        };
    }
}

async function main() {
    console.log('Testando etapas na conta VP do Omie...\n');
    // Omie valid values per their own error message: 00, 10, 20, 30, 40, 50, 70, 80
    const etapas = ['10', '20', '30', '40', '50', '70', '80'];
    for (const etapa of etapas) {
        const result = await testEtapa(etapa);
        const icon = result.rejected ? '❌' : '✅';
        console.log(`  ${icon} Etapa '${etapa}': ${result.status}`);
        await new Promise(r => setTimeout(r, 800));
    }
    console.log('\nConcluído.');
}

main().catch(e => console.error('Erro fatal:', e.message));
