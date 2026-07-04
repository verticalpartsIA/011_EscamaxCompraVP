const fetch = require('node-fetch');
const omieClient = require('./omieClient');
const logger = require('../utils/logger');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const FILIAIS = ['SAOPAULO', 'BRASILIA', 'FLORIANOPOLIS', 'PICARRAS', 'SALVADOR'];
const DATA_INICIAL_PADRAO = '01/01/2024';

function hoje_ddmmaaaa() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function parseDataBR(dataStr) {
    if (!dataStr) return null;
    const [dia, mes, ano] = dataStr.split('/');
    if (!dia || !mes || !ano) return null;
    return `${ano}-${mes}-${dia}`;
}

// Resolve o código de cada filial Escamax como CLIENTE dentro da própria conta
// Omie da VerticalParts (uma única vez por sync).
async function mapearFiliaisPorCodigoCliente() {
    const mapa = new Map(); // codigo_cliente_omie (na VP) -> unidade
    for (const unidade of FILIAIS) {
        const cnpj = (process.env[`CNPJ_${unidade}`] || '').replace(/\D/g, '');
        if (!cnpj) continue;
        try {
            const cliente = await omieClient.consultarCliente(cnpj, 'VP');
            if (cliente?.codigo_cliente_omie) {
                mapa.set(Number(cliente.codigo_cliente_omie), unidade);
            }
        } catch (err) {
            logger.warn(`[comprasHistoricoSync] Não localizei ${unidade} (CNPJ ${cnpj}) como cliente na VP: ${err.message}`);
        }
    }
    return mapa;
}

async function upsertLote(rows) {
    if (rows.length === 0) return null;
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/compras_historico_vp?on_conflict=filial,numero_pedido,codigo_produto`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt.slice(0, 300));
    }
}

// Percorre TODOS os Pedidos de Venda da VerticalParts (uma única varredura,
// cobre as 5 filiais de uma vez) e distribui as linhas por filial conforme o
// cliente do pedido. Isso é o que a VerticalParts VENDEU para cada filial
// Escamax e por quanto — não o que cada filial registrou como compra própria.
async function sincronizarTodasFiliais({ dataInicial = DATA_INICIAL_PADRAO } = {}) {
    if (!SUPABASE_KEY) {
        return [{ ok: false, reason: 'missing_supabase_key' }];
    }

    const mapaClientes = await mapearFiliaisPorCodigoCliente();
    if (mapaClientes.size === 0) {
        logger.error('[comprasHistoricoSync] Nenhuma filial Escamax localizada como cliente na conta VP.');
        return FILIAIS.map(unidade => ({ unidade, ok: false, reason: 'filial_nao_encontrada_como_cliente_vp' }));
    }

    const dataFinal = hoje_ddmmaaaa();
    const contagem = new Map(FILIAIS.map(u => [u, { totalPedidos: new Set(), totalItens: 0 }]));
    const errors = [];

    let pagina = 1;
    let totalPaginas = 1;

    do {
        let data;
        try {
            data = await omieClient.listarPedidosVendaVP({ pagina, registrosPorPagina: 100, dataInicial, dataFinal });
        } catch (err) {
            const detalhe = err.response?.data?.faultstring || err.message;
            errors.push(`pagina ${pagina}: ${detalhe}`);
            break;
        }

        totalPaginas = Number(data?.total_de_paginas || 1);
        const pedidos = data?.pedido_venda_produto || [];

        // Agrega por (filial, numero_pedido, codigo_produto) dentro do lote.
        const porChave = new Map();

        for (const pedido of pedidos) {
            const cab = pedido.cabecalho || {};
            const unidade = mapaClientes.get(Number(cab.codigo_cliente));
            if (!unidade) continue; // pedido de outro cliente, não é filial Escamax

            const numeroPedido = String(cab.numero_pedido || cab.codigo_pedido || '');
            const info = pedido.infoCadastro || {};
            const dataPedido = parseDataBR(info.dFat || info.dInc);

            contagem.get(unidade).totalPedidos.add(numeroPedido);

            for (const item of (pedido.det || [])) {
                const produto = item.produto || {};
                const codigoProduto = String(produto.codigo || produto.codigo_produto || '');
                const chave = `${unidade}|${numeroPedido}|${codigoProduto}`;
                const valor = Number(produto.valor_total ?? produto.valor_mercadoria ?? 0);
                const existente = porChave.get(chave);
                if (existente) {
                    existente.valor += valor;
                } else {
                    porChave.set(chave, {
                        filial: unidade,
                        numero_pedido: numeroPedido,
                        codigo_pedido_omie: cab.codigo_pedido || null,
                        codigo_produto: codigoProduto,
                        descricao: produto.descricao || '',
                        valor,
                        data_pedido: dataPedido,
                        updated_at: new Date().toISOString(),
                    });
                }
            }
        }

        const rows = Array.from(porChave.values());
        for (const row of rows) contagem.get(row.filial).totalItens++;

        try {
            await upsertLote(rows);
        } catch (err) {
            errors.push(`upsert pagina ${pagina}: ${err.message}`);
        }

        if (pagina % 10 === 0 || pagina === totalPaginas) {
            logger.info(`[comprasHistoricoSync] VP: página ${pagina}/${totalPaginas} processada.`);
        }
        pagina++;
    } while (pagina <= totalPaginas);

    const resultados = FILIAIS.map(unidade => {
        const c = contagem.get(unidade);
        return { unidade, ok: errors.length === 0, totalPedidosVP: c.totalPedidos.size, totalItens: c.totalItens };
    });

    if (errors.length > 0) {
        logger.error(`[comprasHistoricoSync] Erros durante a varredura: ${JSON.stringify(errors)}`);
        resultados.push({ errors });
    } else {
        logger.info(`[comprasHistoricoSync] Concluído: ${JSON.stringify(resultados)}`);
    }

    return resultados;
}

// Mantido por compatibilidade com a rota (?unidade=X) — roda a varredura
// completa (é uma única passada pela conta VP) e retorna só o resultado da filial pedida.
async function sincronizarFilial(unidade) {
    const resultados = await sincronizarTodasFiliais();
    return resultados.find(r => r.unidade === unidade) || { unidade, ok: false, reason: 'nao_processado' };
}

module.exports = { sincronizarFilial, sincronizarTodasFiliais, FILIAIS };
