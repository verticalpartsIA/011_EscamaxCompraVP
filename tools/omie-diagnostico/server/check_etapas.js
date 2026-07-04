/**
 * Script para descobrir o código correto da etapa "Separar Estoque / Produção"
 * Testa múltiplos códigos de etapa na API do Omie para o pedido de venda VP.
 */
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '.env') });

const axios = require('axios');

const APP_KEY = process.env.OMIE_APP_KEY;
const APP_SECRET = process.env.OMIE_APP_SECRET;

async function omiePost(call, param) {
    const { data } = await axios.post('https://app.omie.com.br/api/v1/produtos/pedido/', {
        call,
        app_key: APP_KEY,
        app_secret: APP_SECRET,
        param: [param]
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
    return data;
}

async function main() {
    console.log('Key:', APP_KEY ? APP_KEY.substring(0, 8) + '...' : 'NÃO ENCONTRADA');
    if (!APP_KEY) { console.error('Credenciais não encontradas!'); return; }

    // 1. Tenta listar as etapas via endpoint de etapas de pedido
    const calls_to_try = ['ListarEtapas', 'ConsultarEtapas', 'ListarEtapasPedido', 'ListarEtapasFaturamento'];
    for (const c of calls_to_try) {
        try {
            const r = await omiePost(c, {});
            console.log(`\n✅ ${c} FUNCIONOU:`);
            console.log(JSON.stringify(r, null, 2));
            return;
        } catch (e) {
            console.log(`❌ ${c}: ${e.response?.data?.message || e.message}`);
        }
    }

    // 2. Busca um pedido existente para ver qual etapa foi usada
    console.log('\n--- Buscando pedidos existentes para ver etapas disponíveis ---');
    try {
        const r = await omiePost('ListarPedidos', {
            pagina: 1,
            registros_por_pagina: 5,
            apenas_importado_api: 'N'
        });
        const pedidos = r.pedido_venda_produto || r.pedidos || [];
        console.log(`Total de pedidos encontrados: ${r.total_de_registros || 0}`);
        for (const p of pedidos.slice(0, 5)) {
            const cab = p.cabecalho || p;
            console.log(`  Pedido ${cab.numero_pedido || cab.nCodPed} | etapa: "${cab.etapa}" | status: "${cab.etapa_faturamento || ''}"`);
        }
    } catch (e) {
        console.log('Erro ao listar pedidos:', e.response?.data || e.message);
    }

    // 3. Tenta códigos de etapa comuns na Omie (costumam ser strings específicas)
    // Algumas contas usam: 10, 20, 30, 40, 50, 60 — outras usam códigos customizados
    // Vamos tentar criar com etapas compostas conhecidas
    const etapas = ['10', '20', '30', '40', '50', '60',
        '10.010.010', '20.010.010', '30.010.010',
        'Separar', 'SepararEstoque', 'Producao', 'SEPARAR'];
    console.log('\n--- Tentando etapas alternativas (dry-run, código cliente inválido) ---');
    for (const etapa of etapas) {
        try {
            await omiePost('IncluirPedido', {
                cabecalho: {
                    codigo_pedido_integracao: `TEST-DRY-${Date.now()}`,
                    codigo_cliente: 999999999, // cliente inválido — vai falhar mas vemos a msg
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
            console.log(`  ✅ Etapa "${etapa}" ACEITA pelo Omie`);
        } catch (e) {
            const msg = e.response?.data?.faultstring || e.message || '';
            if (msg.includes('não disponível') || msg.includes('não existe') || msg.includes('inválid')) {
                console.log(`  ❌ Etapa "${etapa}": ${msg}`);
            } else {
                // Outro erro (ex: cliente não encontrado) = etapa provavelmente válida!
                console.log(`  ✅ Etapa "${etapa}" PARECE VÁLIDA (erro diferente): ${msg}`);
            }
        }
    }
}

main().catch(e => console.error('Fatal:', e.message));
