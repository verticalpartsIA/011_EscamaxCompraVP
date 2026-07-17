// Fonte de verdade do saldo de estoque VP: tabela `estoque_vp` do Supabase
// (sincronizada de hora em hora da Omie via Edge Function sync-estoque-vp).
// O campo `estoque_atual` de `omie_produtos` vem furado do ListarProdutos
// (0 ou negativo para quase tudo) e NÃO deve ser usado para exibir/validar saldo.
//
// Lido via backend autenticado (GET /api/estoque/vp), não mais direto do
// Supabase com a chave anon — essa tabela não tem mais policy de leitura
// pública (issue #48: dado de estoque real ficava acessível sem login algum).

const API_BASE = import.meta.env.VITE_API_URL || '';

// A sync de estoque cobre só estes prefixos; códigos fora deles não têm saldo
// rastreado (retornam null em vez de 0 para a UI diferenciar "sem rastreio").
const PREFIXOS_RASTREADOS = /^(VPEL|VPER|VPB)/i;

export function codigoRastreado(codigo) {
    return PREFIXOS_RASTREADOS.test(String(codigo || '').trim());
}

// Baixa o saldo disponível de todos os códigos rastreados.
// Retorna Map<codigoUpper, estoque_disponivel>.
export async function fetchEstoqueVPMap() {
    const token = localStorage.getItem('token');
    const resp = await fetch(`${API_BASE}/api/estoque/vp`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Erro ao consultar estoque VerticalParts (${resp.status})`);
    const rows = await resp.json();
    const mapa = new Map();
    for (const row of rows) {
        mapa.set(String(row.codigo).toUpperCase(), Number(row.estoque_disponivel) || 0);
    }
    return mapa;
}

// Anexa `estoque_disponivel` a cada produto do catálogo:
//   número  → saldo real da tabela estoque_vp (0 se rastreado e sem linha)
//   null    → código sem rastreio de saldo (fora dos prefixos VPEL/VPER/VPB)
export function juntarEstoque(produtos, mapaEstoque) {
    return produtos.map(p => {
        const codigo = String(p.codigo || '').trim().toUpperCase();
        const rastreado = codigoRastreado(codigo);
        return {
            ...p,
            estoque_disponivel: rastreado ? (mapaEstoque.get(codigo) ?? 0) : null,
        };
    });
}
