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

// PostgREST desta instância limita a 1000 linhas por request (db-max-rows) —
// pagina via header Range até esgotar. Usado pelos endpoints /api/estoque/*,
// que passaram a ser o único caminho de leitura dessas tabelas depois que a
// policy de leitura pública foi removida (issue #48 — antes o frontend lia
// estoque_vp/estoque_escamax direto do Supabase com a chave anon, sem exigir
// login no portal).
const PAGE_SIZE_SUPABASE = 1000;

async function paginarSupabase(path) {
    const todos = [];
    let offset = 0;
    while (true) {
        const resp = await fetch(`${SUPABASE_URL()}${path}`, {
            headers: {
                'apikey': SUPABASE_KEY(),
                'Authorization': `Bearer ${SUPABASE_KEY()}`,
                'Range': `${offset}-${offset + PAGE_SIZE_SUPABASE - 1}`,
            },
        });
        if (!resp.ok) throw new Error(`estoqueService: Supabase ${resp.status}`);
        const pagina = await resp.json();
        todos.push(...pagina);
        if (pagina.length < PAGE_SIZE_SUPABASE) break;
        offset += PAGE_SIZE_SUPABASE;
    }
    return todos;
}

// Estoque VP completo, todas as colunas — usado por ProdutosVPPage, EstoqueVPPage,
// PecasSemEstoquePage e OutrosFornecedoresPage. Cada tela usa/filtra o subconjunto
// de colunas e códigos que precisa no cliente; a tabela em si cobre mais códigos
// (ex.: corrimões) do que só os prefixos VPEL/VPER/VPB rastreados por saldo.
async function listarEstoqueVPCompleto() {
    const cols = 'codigo,descricao,estoque_fisico,reservado,estoque_disponivel,estoque_minimo,atualizado_em';
    return paginarSupabase(`/rest/v1/estoque_vp?select=${cols}&order=descricao.asc`);
}

// Estoque Escamax de uma filial — usado pela tela Estoque Escamax.
async function listarEstoqueEscamax(unidade) {
    const unidadeUp = String(unidade || '').trim().toUpperCase();
    if (!unidadeUp) throw new Error('Informe a unidade.');
    const cols = 'codigo,descricao,estoque_fisico,reservado,estoque_disponivel,estoque_minimo,atualizado_em';
    return paginarSupabase(`/rest/v1/estoque_escamax?select=${cols}&unidade=eq.${encodeURIComponent(unidadeUp)}&order=descricao.asc`);
}

// Busca disponível + mínimo dos códigos informados. Retorna Map<codigoUpper, {disponivel, minimo}>.
async function buscarEstoqueComMinimo(codigos = []) {
    const unicos = [...new Set(codigos.map(c => String(c || '').trim()).filter(Boolean))];
    if (unicos.length === 0) return new Map();

    const inList = unicos.map(c => `"${c.replace(/"/g, '')}"`).join(',');
    const resp = await fetch(
        `${SUPABASE_URL()}/rest/v1/estoque_vp?codigo=in.(${encodeURIComponent(inList)})&select=codigo,estoque_disponivel,estoque_minimo`,
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
        mapa.set(String(row.codigo).toUpperCase(), {
            disponivel: Number(row.estoque_disponivel) || 0,
            minimo: Number(row.estoque_minimo) || 0,
        });
    }
    return mapa;
}

// Finalidade "Estoque" (reposição interna da filial, sem vínculo a Pedido de Venda
// ou Contrato): a quantidade pedida não pode passar do que falta para a VP voltar
// ao próprio estoque mínimo — mesma regra do módulo M1 do VPRequisições (teto =
// max(0, mínimo - disponível)), mas lendo da nossa própria tabela estoque_vp já
// sincronizada, sem chamada ao vivo na Omie. É uma restrição ADICIONAL: continua
// valendo também a checagem normal de validarEstoqueItens (não dá pra comprar mais
// do que a VP tem fisicamente disponível agora), essa aqui é mais apertada ainda.
async function validarTetoReposicaoEstoque(itens = []) {
    const rastreados = itens.filter(item => codigoRastreado(item.codigo));
    if (rastreados.length === 0) {
        throw new Error('Nenhum item do carrinho tem rastreio de saldo (fora dos prefixos VPEL/VPER/VPB) — a finalidade Estoque não se aplica a esses códigos.');
    }

    let mapa;
    try {
        mapa = await buscarEstoqueComMinimo(rastreados.map(i => i.codigo));
    } catch (e) {
        logger.error(`estoqueService: falha ao consultar teto de reposição: ${e.message}`);
        throw new Error('Não foi possível verificar o estoque mínimo no momento. Tente novamente em instantes.');
    }

    const pedidoPorCodigo = new Map();
    for (const item of rastreados) {
        const chave = String(item.codigo).trim().toUpperCase();
        pedidoPorCodigo.set(chave, (pedidoPorCodigo.get(chave) || 0) + Number(item.quantidade || 0));
    }

    const acimaDoTeto = [];
    for (const [codigo, qtdePedida] of pedidoPorCodigo) {
        const info = mapa.get(codigo);
        const disponivel = info?.disponivel ?? 0;
        const minimo = info?.minimo ?? 0;
        const teto = Math.max(0, minimo - disponivel);
        if (teto <= 0) {
            acimaDoTeto.push(`${codigo}: estoque disponível (${disponivel}) já está no mínimo (${minimo}) ou acima — não é necessário repor agora.`);
        } else if (qtdePedida > teto) {
            acimaDoTeto.push(`${codigo}: quantidade máxima para reposição é ${teto} (disponível ${disponivel}, mínimo ${minimo}), pedido foi ${qtdePedida}.`);
        }
    }

    if (acimaDoTeto.length > 0) {
        throw new Error(acimaDoTeto.join(' | '));
    }
}

module.exports = {
    codigoRastreado,
    buscarEstoqueDisponivel,
    validarEstoqueItens,
    validarTetoReposicaoEstoque,
    listarEstoqueVPCompleto,
    listarEstoqueEscamax,
};
