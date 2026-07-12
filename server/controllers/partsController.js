const fetch = require('../utils/fetchComKeepAlive');
const businessRules = require('../utils/businessRules');
const logger = require('../utils/logger');

// "Consultar Peças" costumava bater direto na Omie a cada busca (listarTodos():
// ListarProdutos + ListarPosEstoque paginados, centenas de chamadas) — lento o
// suficiente pra estourar timeout e devolver 500. Agora lê do Supabase (catálogo
// já sincronizado 4x/dia + estoque sincronizado de hora em hora), sem tocar a
// Omie na hora do clique.
const SUPABASE_URL = () => process.env.SUPABASE_URL || 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_KEY = () => process.env.SUPABASE_SERVICE_KEY;

function headers(extra = {}) {
    return {
        apikey: SUPABASE_KEY(),
        Authorization: `Bearer ${SUPABASE_KEY()}`,
        ...extra,
    };
}

// Mesma regra de inclusão usada antes em omieClient.js#listarTodos: qualquer
// código VP*, exceto matéria-prima/códigos internos.
const PREFIXOS_EXCLUIDOS = ['VPAT', 'VPMP', 'VPCON', 'VPIN', 'VP-E', 'VP-P', 'VPKIT-', 'VPPKIT-'];
function filtroPrefixosQuery() {
    const excludes = PREFIXOS_EXCLUIDOS.map(p => `codigo=not.ilike.${encodeURIComponent(p)}*`).join('&');
    return `codigo=ilike.VP*&${excludes}`;
}

async function buscarMapaEstoque(codigos = null) {
    const filtroCodigos = codigos && codigos.length > 0
        ? `&codigo=in.(${codigos.map(c => `"${c}"`).join(',')})`
        : '';
    const mapa = new Map();
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
        const resp = await fetch(
            `${SUPABASE_URL()}/rest/v1/estoque_vp?select=codigo,estoque_disponivel${filtroCodigos}`,
            { headers: headers({ Range: `${offset}-${offset + PAGE_SIZE - 1}` }) }
        );
        if (!resp.ok) throw new Error(`Supabase estoque_vp: ${resp.status}`);
        const pagina = await resp.json();
        for (const row of pagina) mapa.set(row.codigo, row.estoque_disponivel);
        if (pagina.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        if (filtroCodigos) break; // busca por lista de códigos já vem completa numa página
    }
    return mapa;
}

function mapearProduto(produto, estoqueMap) {
    const categoria = businessRules.identificarCategoria(produto.codigo);
    const precoFinal = businessRules.calcularPrecoEscamax(produto);
    return {
        codigo: produto.codigo,
        descricao: produto.descricao,
        preco: precoFinal,
        preco_original: produto.valor_unitario,
        estoque: estoqueMap.get(produto.codigo) ?? 0,
        categoria,
        url_imagem: null,
    };
}

// GET /api/parts/listar — produtos VP com estoque > 0 (mesmo recorte do antigo listarTodos())
exports.listar = async (req, res) => {
    try {
        logger.info(`Listando estoque VP para: ${req.user.email}`);

        const produtos = [];
        let offset = 0;
        const PAGE_SIZE = 1000;
        while (true) {
            const resp = await fetch(
                `${SUPABASE_URL()}/rest/v1/omie_produtos?select=codigo,descricao,valor_unitario&ativo=eq.true&${filtroPrefixosQuery()}&order=descricao.asc`,
                { headers: headers({ Range: `${offset}-${offset + PAGE_SIZE - 1}` }) }
            );
            if (!resp.ok) throw new Error(`Supabase omie_produtos: ${resp.status}`);
            const pagina = await resp.json();
            produtos.push(...pagina);
            if (pagina.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
        }

        const estoqueMap = await buscarMapaEstoque();
        const resultados = produtos
            .map(p => mapearProduto(p, estoqueMap))
            .filter(p => p.estoque > 0);
        logger.info(`Produtos listados do Supabase: ${resultados.length}`);
        res.json(resultados);
    } catch (error) {
        logger.error(`Erro ao listar produtos: ${error.message}`);
        res.status(500).json({ error: 'Erro ao buscar estoque.', details: error.message });
    }
};

// GET /api/parts/search?q= — busca por termo (código ou descrição)
exports.search = async (req, res) => {
    const { q } = req.query;

    if (!q) {
        return res.status(400).json({ error: 'Termo de busca obrigatório.' });
    }

    try {
        logger.info(`Search: "${q}" por ${req.user.email}`);

        // Busca no catálogo já filtrado (ativo + prefixos válidos) e compara sem
        // acento em JS — o ILIKE do Postgres não ignora acentuação, e é comum
        // digitar "corrimao" sem o til em vez de "corrimão".
        const resp = await fetch(
            `${SUPABASE_URL()}/rest/v1/omie_produtos?select=codigo,descricao,valor_unitario&ativo=eq.true&${filtroPrefixosQuery()}`,
            { headers: headers({ Range: '0-1999' }) }
        );
        if (!resp.ok) throw new Error(`Supabase omie_produtos: ${resp.status}`);
        const todos = await resp.json();

        const marcasDiacriticas = new RegExp(String.fromCharCode(91) + String.fromCharCode(92) + 'u0300-' + String.fromCharCode(92) + 'u036f' + String.fromCharCode(93), 'g');
        const normalizar = s => (s || '').normalize('NFD').replace(marcasDiacriticas, '').toLowerCase();
        const termoNorm = normalizar(q);
        const produtos = todos
            .filter(p => normalizar(p.codigo).includes(termoNorm) || normalizar(p.descricao).includes(termoNorm))
            .sort((a, b) => (a.descricao || '').localeCompare(b.descricao || ''))
            .slice(0, 200);

        const estoqueMap = await buscarMapaEstoque(produtos.map(p => p.codigo));
        const resultados = produtos
            .map(p => mapearProduto(p, estoqueMap))
            .filter(p => p.estoque > 0);
        res.json(resultados);
    } catch (error) {
        logger.error(`Search error: ${error.message}`);
        res.status(500).json({ error: 'Erro ao buscar peças.' });
    }
};
