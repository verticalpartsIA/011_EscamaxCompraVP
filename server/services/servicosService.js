const fetch = require('node-fetch');
const logger = require('../utils/logger');

// Camada de dados do módulo "Requisição de Serviços" — contratação de serviço
// terceirizado pelas filiais Escamax, com aprovação em cadeia (CEO → diretor
// comercial → financeiro). Usa as mesmas tabelas já provisionadas no Supabase
// (solicitations, solicitation_items, solicitation_comments,
// solicitation_attachments, lpu, branches, profiles) com a service key —
// mesmo padrão de orderStore.js/auditoriaService.js: sem supabase-js, REST puro.

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

async function req(path, { method = 'GET', body, extraHeaders } = {}) {
    const resp = await fetch(`${SUPABASE_URL()}${path}`, {
        method,
        headers: headers(extraHeaders),
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`servicosService ${method} ${path}: ${resp.status} ${txt.slice(0, 300)}`);
    }
    if (resp.status === 204) return null;
    return resp.json();
}

// ── Perfis (papéis do módulo de serviços: admin/gerente_filial/diretor_comercial/financeiro) ──
async function buscarProfilePorEmail(email) {
    const rows = await req(`/rest/v1/profiles?email=eq.${encodeURIComponent(String(email || '').toLowerCase())}&select=*`);
    return rows?.[0] || null;
}

async function listarProfiles() {
    return req('/rest/v1/profiles?select=id,full_name,email,role,branch_id,active&order=full_name.asc');
}

// ── Filiais ──
async function listarBranches() {
    return req('/rest/v1/branches?select=*&active=eq.true&order=name.asc');
}

// ── LPU (catálogo de preços de serviço) ──
async function listarLpu({ apenasAtivos = false } = {}) {
    const filtro = apenasAtivos ? '&active=eq.true' : '';
    return req(`/rest/v1/lpu?select=*${filtro}&order=description.asc`);
}

async function criarLpu(item) {
    const rows = await req('/rest/v1/lpu', {
        method: 'POST',
        body: [item],
        extraHeaders: { Prefer: 'return=representation' },
    });
    return rows[0];
}

async function atualizarLpu(id, patch) {
    const rows = await req(`/rest/v1/lpu?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
        extraHeaders: { Prefer: 'return=representation' },
    });
    return rows?.[0] || null;
}

// ── Clientes e fornecedores (upsert por CNPJ) ──
// Tabelas soltas (sem FK declarada, mas usadas de fato pelo app): guardam o
// CNPJ+razão social já consultados, para não repetir a busca externa (BrasilAPI)
// nem duplicar registro quando o mesmo CNPJ aparece em outra requisição.
async function buscarOuCriarCliente({ cnpj, name }) {
    const digits = String(cnpj || '').replace(/\D/g, '');
    if (!digits) return null;
    const existente = await req(`/rest/v1/clients?cnpj=eq.${encodeURIComponent(digits)}&select=id`);
    if (existente?.[0]) return existente[0].id;
    const criado = await req('/rest/v1/clients', {
        method: 'POST',
        body: [{ cnpj: digits, name: name || digits, razao_social: name || null, active: true }],
        extraHeaders: { Prefer: 'return=representation' },
    });
    return criado[0].id;
}

async function buscarOuCriarFornecedor({ cnpj, name }) {
    const digits = String(cnpj || '').replace(/\D/g, '');
    if (!digits) return null;
    const existente = await req(`/rest/v1/suppliers?cnpj=eq.${encodeURIComponent(digits)}&select=id`);
    if (existente?.[0]) return existente[0].id;
    const criado = await req('/rest/v1/suppliers', {
        method: 'POST',
        body: [{ cnpj: digits, name: name || digits, active: true }],
        extraHeaders: { Prefer: 'return=representation' },
    });
    return criado[0].id;
}

async function buscarCliente(id) {
    if (!id) return null;
    const rows = await req(`/rest/v1/clients?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows?.[0] || null;
}

async function buscarFornecedor(id) {
    if (!id) return null;
    const rows = await req(`/rest/v1/suppliers?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows?.[0] || null;
}

// ── Solicitations (requisições de serviço) ──
// filtroOrRequesterBranch: usado pelo gerente_filial — precisa ver as próprias
// requisições E as da sua filial (OR, não AND), por isso é tratado à parte
// via o filtro "or=(...)" do PostgREST em vez dos params AND normais.
async function listarSolicitations({ filtroRequesterId, filtroBranchId, filtroStatusIn, filtroOrRequesterBranch } = {}) {
    const params = new URLSearchParams({ select: '*', order: 'created_at.desc' });
    if (filtroRequesterId) params.set('requester_id', `eq.${filtroRequesterId}`);
    if (filtroBranchId) params.set('branch_id', `eq.${filtroBranchId}`);
    if (filtroStatusIn) params.set('status', `in.(${filtroStatusIn.join(',')})`);
    if (filtroOrRequesterBranch) {
        const { requesterId, branchId } = filtroOrRequesterBranch;
        const condicoes = [`requester_id.eq.${requesterId}`];
        if (branchId) condicoes.push(`branch_id.eq.${branchId}`);
        params.set('or', `(${condicoes.join(',')})`);
    }
    return req(`/rest/v1/solicitations?${params}`);
}

async function buscarSolicitation(id) {
    const rows = await req(`/rest/v1/solicitations?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows?.[0] || null;
}

async function criarSolicitation(dados) {
    const rows = await req('/rest/v1/solicitations', {
        method: 'POST',
        body: [dados],
        extraHeaders: { Prefer: 'return=representation' },
    });
    return rows[0];
}

async function atualizarSolicitation(id, patch) {
    const rows = await req(`/rest/v1/solicitations?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { ...patch, updated_at: new Date().toISOString() },
        extraHeaders: { Prefer: 'return=representation' },
    });
    if (!rows?.length) throw new Error('Requisição não encontrada.');
    return rows[0];
}

// ── Itens ──
async function listarItens(solicitationId) {
    return req(`/rest/v1/solicitation_items?solicitation_id=eq.${encodeURIComponent(solicitationId)}&select=*&order=created_at.asc`);
}

async function adicionarItem(solicitationId, item) {
    const rows = await req('/rest/v1/solicitation_items', {
        method: 'POST',
        body: [{ ...item, solicitation_id: solicitationId }],
        extraHeaders: { Prefer: 'return=representation' },
    });
    return rows[0];
}

async function removerItem(solicitationId, itemId) {
    await req(`/rest/v1/solicitation_items?id=eq.${encodeURIComponent(itemId)}&solicitation_id=eq.${encodeURIComponent(solicitationId)}`, {
        method: 'DELETE',
        extraHeaders: { Prefer: 'return=minimal' },
    });
}

// ── Comentários / histórico ──
async function listarComentarios(solicitationId) {
    return req(`/rest/v1/solicitation_comments?solicitation_id=eq.${encodeURIComponent(solicitationId)}&select=*&order=created_at.asc`);
}

async function adicionarComentario({ solicitationId, userId, comment, action = null }) {
    const rows = await req('/rest/v1/solicitation_comments', {
        method: 'POST',
        body: [{ solicitation_id: solicitationId, user_id: userId, comment, action }],
        extraHeaders: { Prefer: 'return=representation' },
    });
    return rows[0];
}

// ── Anexos ──
async function listarAnexos(solicitationId) {
    return req(`/rest/v1/solicitation_attachments?solicitation_id=eq.${encodeURIComponent(solicitationId)}&select=*&order=created_at.asc`);
}

async function registrarAnexo({ solicitationId, userId, fileName, filePath, fileSize, mimeType }) {
    const rows = await req('/rest/v1/solicitation_attachments', {
        method: 'POST',
        body: [{
            solicitation_id: solicitationId,
            user_id: userId,
            file_name: fileName,
            file_path: filePath,
            file_size: fileSize || null,
            mime_type: mimeType || null,
        }],
        extraHeaders: { Prefer: 'return=representation' },
    });
    return rows[0];
}

// Upload binário direto no Storage (bucket "proposals"), com a service key —
// bypassa RLS de storage, autorização já é feita no controller.
async function uploadAnexoStorage(path, buffer, mimeType) {
    const resp = await fetch(`${SUPABASE_URL()}/storage/v1/object/proposals/${path}`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY(),
            'Authorization': `Bearer ${SUPABASE_KEY()}`,
            'Content-Type': mimeType || 'application/octet-stream',
        },
        body: buffer,
    });
    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`Falha ao enviar anexo: ${resp.status} ${txt.slice(0, 300)}`);
    }
    return resp.json();
}

async function urlAssinadaAnexo(path, expiresInSeconds = 300) {
    const resp = await fetch(`${SUPABASE_URL()}/storage/v1/object/sign/proposals/${path}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`Falha ao gerar link do anexo: ${resp.status} ${txt.slice(0, 300)}`);
    }
    const data = await resp.json();
    return `${SUPABASE_URL()}/storage/v1${data.signedURL}`;
}

module.exports = {
    buscarProfilePorEmail,
    listarProfiles,
    listarBranches,
    buscarOuCriarCliente,
    buscarOuCriarFornecedor,
    buscarCliente,
    buscarFornecedor,
    listarLpu,
    criarLpu,
    atualizarLpu,
    listarSolicitations,
    buscarSolicitation,
    criarSolicitation,
    atualizarSolicitation,
    listarItens,
    adicionarItem,
    removerItem,
    listarComentarios,
    adicionarComentario,
    listarAnexos,
    registrarAnexo,
    uploadAnexoStorage,
    urlAssinadaAnexo,
};
