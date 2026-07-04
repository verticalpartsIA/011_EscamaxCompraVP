const fetch = require('node-fetch');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const DOMINIOS_POR_EMPRESA = {
    escamax: '@escamax.com.br',
    verticalparts: '@verticalparts.com.br',
};

function headers() {
    return {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
    };
}

function normalizarEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function validarDominio(email, empresa) {
    const dominio = DOMINIOS_POR_EMPRESA[empresa];
    if (!dominio) throw new Error(`Empresa inválida: ${empresa}. Use "escamax" ou "verticalparts".`);
    if (!normalizarEmail(email).endsWith(dominio)) {
        throw new Error(`E-mail precisa terminar em ${dominio} para a empresa "${empresa}".`);
    }
}

async function buscarUsuarioPorEmail(email) {
    const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(normalizarEmail(email))}&select=*`,
        { headers: headers() }
    );
    if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
    const data = await resp.json();
    return data?.[0] || null;
}

async function listarUsuarios() {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?select=*&order=criado_em.asc`, { headers: headers() });
    if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
    return resp.json();
}

// Convida um novo usuário: valida domínio × empresa, dispara o e-mail de
// convite via Supabase Auth (usa o SMTP configurado) e cria o perfil em
// `usuarios`. Se o e-mail já tiver conta no Auth (ex.: já usada em outro
// sistema VerticalParts), só cria/atualiza o perfil, sem reenviar convite.
async function convidarUsuario({ email, nome, empresa, isAdmin = false, alcadaNivel = null, convidadoPor }) {
    const emailNorm = normalizarEmail(email);
    validarDominio(emailNorm, empresa);

    const redirectTo = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/aceitar-convite`;
    const inviteResp = await fetch(`${SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ email: emailNorm }),
    });
    const inviteData = await inviteResp.json();

    let userId = inviteData?.id;
    let jaExistia = false;

    if (!inviteResp.ok) {
        if (inviteData?.error_code === 'email_exists') {
            jaExistia = true;
            // Busca o id existente no Auth via admin API
            const buscaResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(emailNorm)}`, {
                headers: headers(),
            });
            const buscaData = await buscaResp.json();
            userId = buscaData?.users?.[0]?.id || buscaData?.[0]?.id;
        } else {
            throw new Error(inviteData?.msg || inviteData?.error || 'Erro ao enviar convite.');
        }
    }

    if (!userId) throw new Error('Não foi possível determinar o ID do usuário no Auth.');

    const perfilResp = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
        method: 'POST',
        headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([{
            id: userId,
            email: emailNorm,
            nome,
            empresa,
            is_admin: isAdmin,
            alcada_nivel: alcadaNivel,
            ativo: true,
            convidado_por: convidadoPor || null,
        }]),
    });
    if (!perfilResp.ok) {
        const txt = await perfilResp.text();
        throw new Error(`Erro ao salvar perfil: ${txt.slice(0, 300)}`);
    }
    const perfil = (await perfilResp.json())?.[0];

    return { perfil, jaExistiaNoAuth: jaExistia, conviteEnviado: !jaExistia };
}

// Valida e-mail + senha contra o Supabase Auth (password grant).
async function autenticarComSenha(email, senha) {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
        body: JSON.stringify({ email: normalizarEmail(email), password: senha }),
    });
    const data = await resp.json();
    if (!resp.ok) {
        throw new Error(data?.error_description || data?.msg || 'E-mail ou senha inválidos.');
    }
    return data; // { access_token, user, ... }
}

module.exports = {
    validarDominio,
    buscarUsuarioPorEmail,
    listarUsuarios,
    convidarUsuario,
    autenticarComSenha,
    normalizarEmail,
    DOMINIOS_POR_EMPRESA,
};
