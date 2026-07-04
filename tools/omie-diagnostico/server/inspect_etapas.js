/**
 * Inspeciona os pedidos recentes para ver o mapeamento etapa → coluna kanban
 */
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '.env') });

const axios = require('axios');
const APP_KEY = process.env.OMIE_APP_KEY;
const APP_SECRET = process.env.OMIE_APP_SECRET;

async function omiePost(endpoint, call, param) {
    const { data } = await axios.post(`https://app.omie.com.br/api/v1/${endpoint}`, {
        call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param]
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
    return data;
}

async function main() {
    // Busca os 10 pedidos mais recentes com todos os detalhes
    const r = await omiePost('produtos/pedido/', 'ListarPedidos', {
        pagina: 1,
        registros_por_pagina: 10,
        apenas_importado_api: 'N'
    });

    const pedidos = r.pedido_venda_produto || [];
    console.log(`=== ÚLTIMOS ${pedidos.length} PEDIDOS NA VP ===`);
    for (const p of pedidos) {
        const cab = p.cabecalho || {};
        console.log(`\nPedido: ${cab.numero_pedido}`);
        console.log(`  etapa: "${cab.etapa}"`);
        console.log(`  codigo_status: "${cab.codigo_status || ''}"`);
        console.log(`  descricao_status: "${cab.descricao_status || ''}"`);
        // Imprime todas as chaves do cabecalho para investigar
        const etapaKeys = Object.keys(cab).filter(k => k.toLowerCase().includes('etap') || k.toLowerCase().includes('status') || k.toLowerCase().includes('kanban') || k.toLowerCase().includes('fase') || k.toLowerCase().includes('estagio'));
        for (const k of etapaKeys) {
            console.log(`  ${k}: "${cab[k]}"`);
        }
    }

    // Também testa criar com etapa '60' pra ver se funciona (com cliente inválido)
    console.log('\n=== TESTANDO ETAPAS VÁLIDAS ===');
    for (const etapa of ['10', '20', '30', '40', '50', '70', '80']) {
        try {
            await omiePost('produtos/pedido/', 'IncluirPedido', {
                cabecalho: {
                    codigo_pedido_integracao: `TEST-${etapa}-${Date.now()}`,
                    codigo_cliente: 999999999,
                    data_previsao: '27/02/2026',
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
            console.log(`  ✅ Etapa "${etapa}" ACEITA`);
        } catch (e) {
            const msg = e.response?.data?.faultstring || e.message || '';
            const isEtapaInvalida = msg.includes('não disponível') || msg.includes('não existe') || msg.toLowerCase().includes('etapa');
            console.log(`  ${isEtapaInvalida ? '❌' : '✅'} Etapa "${etapa}": ${msg.substring(0, 80)}`);
        }
    }
}

main().catch(e => console.error('Erro:', e.response?.data || e.message));
