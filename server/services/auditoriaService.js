const fetch = require('../utils/fetchComKeepAlive');
const logger = require('../utils/logger');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function headers() {
    return {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
    };
}

// Registra uma acao no log de auditoria. Nunca lanca erro para nao quebrar o
// fluxo principal — se o log falhar, só avisa no console do servidor.
async function registrarLog({ usuarioEmail, acao, detalhes = null, pedidoId = null }) {
    try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/logs_auditoria`, {
            method: 'POST',
            headers: { ...headers(), 'Prefer': 'return=representation' },
            body: JSON.stringify([{ usuario_email: usuarioEmail, acao, detalhes, pedido_id: pedidoId }]),
        });
        if (!resp.ok) {
            const txt = await resp.text();
            logger.warn(`[auditoria] falha ao registrar log: ${txt.slice(0, 200)}`);
            return null;
        }
        const data = await resp.json();
        return data?.[0] || null;
    } catch (err) {
        logger.warn(`[auditoria] erro ao registrar log: ${err.message}`);
        return null;
    }
}

async function listarLogs({ pedidoId, limit = 200 } = {}) {
    const params = new URLSearchParams({
        select: '*',
        order: 'criado_em.desc',
        limit: String(limit),
    });
    if (pedidoId) params.set('pedido_id', `eq.${pedidoId}`);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/logs_auditoria?${params}`, { headers: headers() });
    if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
    return resp.json();
}

async function adicionarObservacao({ logId, autorEmail, mensagem }) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/log_observacoes`, {
        method: 'POST',
        headers: { ...headers(), 'Prefer': 'return=representation' },
        body: JSON.stringify([{ log_id: logId, autor_email: autorEmail, mensagem }]),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt.slice(0, 300));
    }
    const data = await resp.json();
    return data?.[0] || null;
}

async function listarObservacoes(logId) {
    const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/log_observacoes?log_id=eq.${logId}&select=*&order=criado_em.asc`,
        { headers: headers() }
    );
    if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
    return resp.json();
}

module.exports = { registrarLog, listarLogs, adicionarObservacao, listarObservacoes };
