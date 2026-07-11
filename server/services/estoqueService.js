const fetch = require('node-fetch');
const logger = require('../utils/logger');

// Consulta a tabela `estoque_vp` (fonte real, sincronizada via Edge Function/Omie
// ListarPosEstoque) — não usa `omie_produtos.estoque_atual`, que fica zerado (bug conhecido
// do ListarProdutos, ver CLAUDE.md).

const SUPABASE_URL = () => process.env.SUPABASE_URL || 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_KEY = () => process.env.SUPABASE_SERVICE_KEY;

function headers() {
    return {
        'apikey': SUPABASE_KEY(),
        'Authorization': `Bearer ${SUPABASE_KEY()}`,
    };
}

// Retorna Map código(lowercase) -> estoque_disponivel para os códigos informados.
// Código ausente na tabela não entra no Map (sem controle de estoque cadastrado para ele,
// quem chama decide se isso bloqueia ou não). Em caso de falha na consulta, retorna Map vazio
// e loga um warning — checagem de estoque não deve derrubar o checkout por instabilidade do
// Supabase.
async function consultarEstoqueDisponivel(codigos = []) {
    const unicos = [...new Set(codigos.filter(Boolean).map(String))];
    if (unicos.length === 0) return new Map();

    if (!SUPABASE_KEY()) {
        logger.warn('estoqueService: SUPABASE_SERVICE_KEY não configurada — checagem de estoque ignorada');
        return new Map();
    }

    try {
        const listaFiltro = unicos.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',');
        const params = new URLSearchParams({
            select: 'codigo,estoque_disponivel',
            codigo: `in.(${listaFiltro})`,
        });
        const resp = await fetch(`${SUPABASE_URL()}/rest/v1/estoque_vp?${params.toString()}`, { headers: headers() });
        if (!resp.ok) {
            logger.warn(`estoqueService: falha ao consultar estoque_vp (HTTP ${resp.status}) — checagem de estoque ignorada`);
            return new Map();
        }
        const rows = await resp.json();
        const mapa = new Map();
        for (const row of rows) {
            mapa.set(String(row.codigo).toLowerCase(), Number(row.estoque_disponivel || 0));
        }
        return mapa;
    } catch (e) {
        logger.warn(`estoqueService: erro ao consultar estoque_vp — checagem de estoque ignorada: ${e.message}`);
        return new Map();
    }
}

module.exports = { consultarEstoqueDisponivel };
