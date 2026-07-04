/**
 * Lista as etapas únicas dos pedidos existentes na conta VP do Omie
 */
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '.env') });

const axios = require('axios');
const APP_KEY = process.env.OMIE_APP_KEY;
const APP_SECRET = process.env.OMIE_APP_SECRET;

async function omiePost(call, param) {
    const { data } = await axios.post('https://app.omie.com.br/api/v1/produtos/pedido/', {
        call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param]
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
    return data;
}

async function main() {
    const etapasEncontradas = new Set();
    const exemplos = {};

    // Pega apenas as primeiras 3 páginas (150 pedidos) para ter uma boa amostra
    for (let pagina = 1; pagina <= 3; pagina++) {
        const r = await omiePost('ListarPedidos', {
            pagina,
            registros_por_pagina: 50,
            apenas_importado_api: 'N'
        });
        const pedidos = r.pedido_venda_produto || [];
        if (pedidos.length === 0) break;

        for (const p of pedidos) {
            const cab = p.cabecalho || p;
            const etapa = cab.etapa || '???';
            etapasEncontradas.add(etapa);
            if (!exemplos[etapa]) {
                exemplos[etapa] = {
                    numero: cab.numero_pedido,
                    status_pedido: cab.etapa_faturamento || cab.codigo_status || '',
                };
            }
        }
        console.log(`Página ${pagina}: ${pedidos.length} pedidos analisados`);
    }

    console.log('\n=== ETAPAS ENCONTRADAS NOS PEDIDOS VP ===');
    for (const etapa of [...etapasEncontradas].sort()) {
        const ex = exemplos[etapa];
        console.log(`  Etapa: "${etapa}" | Ex: Pedido ${ex.numero} | status: "${ex.status_pedido}"`);
    }
    console.log('\nTotal de etapas únicas:', etapasEncontradas.size);
}

main().catch(e => console.error('Erro:', e.response?.data || e.message));
