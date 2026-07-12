// Fonte de verdade do saldo de estoque VP: tabela `estoque_vp` do Supabase
// (sincronizada de hora em hora da Omie via Edge Function sync-estoque-vp).
// O campo `estoque_atual` de `omie_produtos` vem furado do ListarProdutos
// (0 ou negativo para quase tudo) e NÃO deve ser usado para exibir/validar saldo.

const SUPABASE_URL = 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZ3ZsY3NreG9wcnlxdmhvZnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3ODc0NjIsImV4cCI6MjA5MDM2MzQ2Mn0.Hzl6k-TM_U1Ae8cNUPtz8MFBbZ4EVF3EGOhvgV7xnqk';

// A sync de estoque cobre só estes prefixos; códigos fora deles não têm saldo
// rastreado (retornam null em vez de 0 para a UI diferenciar "sem rastreio").
const PREFIXOS_RASTREADOS = /^(VPEL|VPER|VPB)/i;

export function codigoRastreado(codigo) {
    return PREFIXOS_RASTREADOS.test(String(codigo || '').trim());
}

const headers = {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${SUPABASE_ANON}`,
};

// Baixa o saldo disponível de todos os códigos rastreados.
// Retorna Map<codigoUpper, estoque_disponivel>.
export async function fetchEstoqueVPMap() {
    const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/estoque_vp?select=codigo,estoque_disponivel&limit=5000`,
        { headers }
    );
    if (!resp.ok) throw new Error(`Supabase estoque_vp ${resp.status}`);
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
