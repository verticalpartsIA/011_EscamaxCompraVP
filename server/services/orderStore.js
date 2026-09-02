const fetch = require('../utils/fetchComKeepAlive');
const logger = require('../utils/logger');

// Persistência de pedidos no Supabase (tabela `pedidos`), substituindo o antigo
// data/orders.json. O objeto completo do pedido vive na coluna jsonb `dados`;
// colunas escalares (unidade, criado_em, idempotency_key) existem para índice.
// A coluna `versao` implementa concorrência otimista: dois updates simultâneos
// no mesmo pedido nunca se sobrescrevem silenciosamente — o perdedor relê e
// reaplica (comportamento que o arquivo local nunca garantiu).

const SUPABASE_URL = () => process.env.SUPABASE_URL || 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_KEY = () => process.env.SUPABASE_SERVICE_KEY;

function headers(extra = {}) {
    return {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY(),
        'Authorization': `Bearer ${SUPABASE_KEY()}`,
        ...extra,
    };
}

async function readOrders() {
    const resp = await fetch(
        `${SUPABASE_URL()}/rest/v1/pedidos?select=dados&order=criado_em.desc&limit=5000`,
        { headers: headers() }
    );
    if (!resp.ok) throw new Error(`orderStore.readOrders: Supabase ${resp.status}`);
    const rows = await resp.json();
    return rows.map(r => r.dados);
}

async function appendOrder(entry) {
    const resp = await fetch(`${SUPABASE_URL()}/rest/v1/pedidos`, {
        method: 'POST',
        headers: headers({ 'Prefer': 'return=minimal' }),
        body: JSON.stringify([{
            id: entry.id,
            criado_em: entry.criadoEm || new Date().toISOString(),
            unidade: entry.unidade || null,
            idempotency_key: entry.idempotencyKey || null,
            dados: entry,
        }]),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`orderStore.appendOrder: ${txt.slice(0, 300)}`);
    }
    return entry;
}

async function findOrder(id) {
    const resp = await fetch(
        `${SUPABASE_URL()}/rest/v1/pedidos?id=eq.${encodeURIComponent(id)}&select=dados`,
        { headers: headers() }
    );
    if (!resp.ok) throw new Error(`orderStore.findOrder: Supabase ${resp.status}`);
    const rows = await resp.json();
    return rows[0]?.dados || null;
}

async function findOrderByIdempotencyKey(key) {
    const normalized = String(key || '').trim();
    if (!normalized) return null;
    const resp = await fetch(
        `${SUPABASE_URL()}/rest/v1/pedidos?idempotency_key=eq.${encodeURIComponent(normalized)}&select=dados`,
        { headers: headers() }
    );
    if (!resp.ok) throw new Error(`orderStore.findOrderByIdempotencyKey: Supabase ${resp.status}`);
    const rows = await resp.json();
    return rows[0]?.dados || null;
}

// Lê o pedido, aplica o updater e grava de volta com checagem de versão.
// Se outro processo gravou no meio do caminho (0 linhas afetadas), relê e
// reaplica o updater — até 3 tentativas.
async function updateOrder(id, updater) {
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
        const resp = await fetch(
            `${SUPABASE_URL()}/rest/v1/pedidos?id=eq.${encodeURIComponent(id)}&select=dados,versao`,
            { headers: headers() }
        );
        if (!resp.ok) throw new Error(`orderStore.updateOrder(read): Supabase ${resp.status}`);
        const rows = await resp.json();
        if (!rows[0]) return null;

        const { dados, versao } = rows[0];
        const updated = updater({ ...dados });

        const patch = await fetch(
            `${SUPABASE_URL()}/rest/v1/pedidos?id=eq.${encodeURIComponent(id)}&versao=eq.${versao}`,
            {
                method: 'PATCH',
                headers: headers({ 'Prefer': 'return=representation' }),
                body: JSON.stringify({
                    dados: updated,
                    versao: versao + 1,
                    unidade: updated.unidade || null,
                    atualizado_em: new Date().toISOString(),
                }),
            }
        );
        if (!patch.ok) {
            const txt = await patch.text();
            throw new Error(`orderStore.updateOrder(write): ${txt.slice(0, 300)}`);
        }
        const changed = await patch.json();
        if (changed.length > 0) return updated;

        logger.warn(`orderStore.updateOrder: conflito de versão no pedido ${id} (tentativa ${tentativa}), reaplicando...`);
    }
    throw new Error(`orderStore.updateOrder: não foi possível atualizar o pedido ${id} após 3 tentativas (concorrência).`);
}

async function deleteOrder(id) {
    const resp = await fetch(
        `${SUPABASE_URL()}/rest/v1/pedidos?id=eq.${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: headers({ 'Prefer': 'return=representation' }) }
    );
    if (!resp.ok) throw new Error(`orderStore.deleteOrder: Supabase ${resp.status}`);
    const deleted = await resp.json();
    return deleted.length > 0;
}

module.exports = {
    readOrders,
    appendOrder,
    findOrder,
    findOrderByIdempotencyKey,
    updateOrder,
    deleteOrder,
};
