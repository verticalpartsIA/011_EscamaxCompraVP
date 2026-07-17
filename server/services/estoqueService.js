const fetch = require('../utils/fetchComKeepAlive');
const logger = require('../utils/logger');

// Validação de estoque no checkout, lendo a tabela `estoque_vp` do Supabase
// (populada de hora em hora pela Edge Function sync-estoque-vp a partir do
// ListarPosEstoque da Omie). O campo `estoque_atual` de `omie_produtos` NÃO é
// confiável (vem zerado/negativo do ListarProdutos) — a fonte de verdade de
// saldo é `estoque_vp.estoque_disponivel`.

const SUPABASE_URL = () => process.env.SUPABASE_URL || 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_KEY = () => process.env.SUPABASE_SERVICE_KEY;

// A sync de estoque só cobre estes prefixos (peças do catálogo do portal).
// Códigos fora deles (ex.: VP-Handrail) não têm rastreio de saldo — o checkout
// não bloqueia esses, só registra warning.
const PREFIXOS_RASTREADOS = /^(VPEL|VPER|VPB)/i;

function codigoRastreado(codigo) {
    return PREFIXOS_RASTREADOS.test(String(codigo || '').trim());
}

// Busca o saldo disponível dos códigos informados. Retorna Map<codigoUpper, disponivel>.
async function buscarEstoqueDisponivel(codigos = []) {
    const unicos = [...new Set(codigos.map(c => String(c || '').trim()).filter(Boolean))];
    if (unicos.length === 0) return new Map();

    const inList = unicos.map(c => `"${c.replace(/"/g, '')}"`).join(',');
    const resp = await fetch(
        `${SUPABASE_URL()}/rest/v1/estoque_vp?codigo=in.(${encodeURIComponent(inList)})&select=codigo,estoque_disponivel`,
        {
            headers: {
                'apikey': SUPABASE_KEY(),
                'Authorization': `Bearer ${SUPABASE_KEY()}`,
            },
        }
    );
    if (!resp.ok) throw new Error(`estoqueService: Supabase ${resp.status}`);
    const rows = await resp.json();

    const mapa = new Map();
    for (const row of rows) {
        mapa.set(String(row.codigo).toUpperCase(), Number(row.estoque_disponivel) || 0);
    }
    return mapa;
}

// Valida se há saldo disponível para todos os itens do carrinho. Soma as
// quantidades quando o mesmo código aparece mais de uma vez. Lança erro com a
// lista de itens sem saldo — política: bloquear venda sem estoque (nada de
// estoque negativo vendável).
async function validarEstoqueItens(itens = []) {
    const rastreados = itens.filter(item => codigoRastreado(item.codigo));
    const ignorados = itens.filter(item => !codigoRastreado(item.codigo));
    for (const item of ignorados) {
        logger.warn(`estoqueService: código ${item.codigo} sem rastreio de saldo (fora dos prefixos VPEL/VPER/VPB) — checagem de estoque pulada para este item`);
    }
    if (rastreados.length === 0) return;

    let mapa;
    try {
        mapa = await buscarEstoqueDisponivel(rastreados.map(i => i.codigo));
    } catch (e) {
        logger.error(`estoqueService: falha ao consultar estoque_vp: ${e.message}`);
        throw new Error('Não foi possível verificar o estoque disponível no momento. Tente novamente em instantes.');
    }

    // Quantidade total pedida por código (carrinho pode repetir o mesmo código)
    const pedidoPorCodigo = new Map();
    for (const item of rastreados) {
        const chave = String(item.codigo).trim().toUpperCase();
        pedidoPorCodigo.set(chave, (pedidoPorCodigo.get(chave) || 0) + Number(item.quantidade || 0));
    }

    const semSaldo = [];
    for (const [codigo, qtdePedida] of pedidoPorCodigo) {
        const disponivel = mapa.get(codigo) ?? 0;
        if (disponivel < qtdePedida) {
            // A Escamax só pode comprar da VP até o saldo real dela — o texto orienta
            // explicitamente o caminho para o excedente (Outros Fornecedores), em vez de
            // só reportar o número (ver issue #38).
            semSaldo.push(
                disponivel > 0
                    ? `A VerticalParts possui apenas ${disponivel} unidade(s) de ${codigo} (pedido: ${qtdePedida}). Ajuste a quantidade para ${disponivel} ou direcione o restante para Outros Fornecedores.`
                    : `A VerticalParts não possui ${codigo} em estoque no momento (pedido: ${qtdePedida}). Direcione este item para Outros Fornecedores.`
            );
        }
    }

    if (semSaldo.length > 0) {
        throw new Error(semSaldo.join(' | '));
    }
}

module.exports = {
    codigoRastreado,
    buscarEstoqueDisponivel,
    validarEstoqueItens,
};
