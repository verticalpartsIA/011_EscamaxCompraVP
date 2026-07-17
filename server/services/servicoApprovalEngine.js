const logger = require('../utils/logger');
const { buscarProfilePorEmail } = require('./servicosService');

// Máquina de estados da Requisição de Serviço (contratação de serviço
// terceirizado). Estados vivos na tabela `solicitations.status`.
//
//   rascunho ──(enviar)──► aguardando_ceo ──(CEO aprova)──► analise_diretor
//                                │                                │
//                        (CEO pede ajuste                 (diretor aprova)
//                         ou rejeita)                             │
//                                │                        aprovado_diretor
//                                ▼                                │
//                       ajuste_solicitante              (financeiro inicia)
//                                │                                │
//                        (reenviar, sempre                em_analise_financeiro
//                         volta pro gate do CEO)                  │
//                                └───────────────►    (financeiro aprova/pede
//                                                       ajuste pagamento/rejeita)
//
// Gatilho de segurança: TODA requisição, ao ser enviada ou reenviada após
// ajuste, entra obrigatoriamente em `aguardando_ceo` — nenhuma requisição
// avança para análise comercial/financeira sem o aval do CEO da VerticalParts.
const STATUS = {
    RASCUNHO: 'rascunho',
    AGUARDANDO_CEO: 'aguardando_ceo',
    ANALISE_DIRETOR: 'analise_diretor',
    AJUSTE_SOLICITANTE: 'ajuste_solicitante',
    APROVADO_DIRETOR: 'aprovado_diretor',
    EM_ANALISE_FINANCEIRO: 'em_analise_financeiro',
    AJUSTE_PAGAMENTO: 'ajuste_pagamento',
    APROVADO: 'aprovado',
    REJEITADO: 'rejeitado',
    CANCELADO: 'cancelado',
};

// E-mail do aprovador do gate do CEO. Configurável via .env — hoje aponta
// para Diego (adm@escamax.com.br), definido nominalmente pelo negócio como o
// CEO da VerticalParts para este fluxo. Intencionalmente NÃO aceita qualquer
// admin como substituto: o requisito é um aprovador designado, não um papel.
const CEO_EMAIL = () => (process.env.SERVICOS_CEO_EMAIL || 'adm@escamax.com.br').toLowerCase();

function isCeoAprovador(email) {
    return String(email || '').toLowerCase().trim() === CEO_EMAIL();
}

// Estados em que o solicitante (dono da requisição) ainda pode editar/enviar.
const ESTADOS_EDITAVEIS_SOLICITANTE = [STATUS.RASCUNHO, STATUS.AJUSTE_SOLICITANTE];

// Estados que ainda não chegaram a uma decisão final — cancelamento permitido.
const ESTADOS_CANCELAVEIS = [
    STATUS.RASCUNHO, STATUS.AGUARDANDO_CEO, STATUS.ANALISE_DIRETOR,
    STATUS.AJUSTE_SOLICITANTE, STATUS.APROVADO_DIRETOR,
    STATUS.EM_ANALISE_FINANCEIRO, STATUS.AJUSTE_PAGAMENTO,
];

async function papelDoUsuario(email) {
    const profile = await buscarProfilePorEmail(email);
    if (!profile || !profile.active) return { profile: null, role: null };
    return { profile, role: profile.role };
}

function podeEditar(solicitation, profile) {
    if (!profile) return false;
    if (profile.role === 'admin') return true;
    return solicitation.requester_id === profile.id && ESTADOS_EDITAVEIS_SOLICITANTE.includes(solicitation.status);
}

function podeCancelar(solicitation, profile) {
    if (!profile) return false;
    if (!ESTADOS_CANCELAVEIS.includes(solicitation.status)) return false;
    if (profile.role === 'admin') return true;
    return solicitation.requester_id === profile.id;
}

// Envia (ou reenvia) a requisição — sempre pousa em aguardando_ceo, o gate
// obrigatório, não importa de qual estado editável ela veio.
function validarEnviar({ solicitation, profile }) {
    if (!profile) throw new Error('Usuário sem perfil no módulo de Requisição de Serviços.');
    if (solicitation.requester_id !== profile.id && profile.role !== 'admin') {
        throw new Error('Apenas o solicitante (ou um admin) pode enviar esta requisição.');
    }
    if (!ESTADOS_EDITAVEIS_SOLICITANTE.includes(solicitation.status)) {
        throw new Error(`Requisição no estado "${solicitation.status}" não pode ser enviada.`);
    }
    // Fornecedor terceirizado é o objeto da contratação — sem ele a requisição
    // chega ao CEO/diretor/financeiro sem rastreabilidade comercial (issue #44).
    if (!solicitation.supplier_id) {
        throw new Error('Informe o fornecedor terceirizado antes de enviar a requisição.');
    }
    return { novoStatus: STATUS.AGUARDANDO_CEO, acao: 'enviado' };
}

// Decisão do CEO sobre o gate obrigatório.
function validarDecisaoCeo({ solicitation, email, decisao }) {
    if (!isCeoAprovador(email)) {
        throw new Error('Ação restrita ao CEO da VerticalParts designado para este fluxo.');
    }
    if (solicitation.status !== STATUS.AGUARDANDO_CEO) {
        throw new Error('Esta requisição não está aguardando o aval do CEO.');
    }
    if (decisao === 'aprovar') return { novoStatus: STATUS.ANALISE_DIRETOR, acao: 'aprovado_ceo' };
    if (decisao === 'ajustar') return { novoStatus: STATUS.AJUSTE_SOLICITANTE, acao: 'ajuste_solicitado_ceo' };
    if (decisao === 'rejeitar') return { novoStatus: STATUS.REJEITADO, acao: 'rejeitado_ceo' };
    throw new Error('Decisão inválida. Use aprovar, ajustar ou rejeitar.');
}

// Decisão do diretor comercial (escopo/preço do serviço).
function validarDecisaoDiretor({ solicitation, profile, decisao }) {
    if (!profile || (profile.role !== 'diretor_comercial' && profile.role !== 'admin')) {
        throw new Error('Ação restrita ao diretor comercial.');
    }
    if (solicitation.status !== STATUS.ANALISE_DIRETOR) {
        throw new Error('Esta requisição não está em análise do diretor comercial.');
    }
    if (decisao === 'aprovar') return { novoStatus: STATUS.APROVADO_DIRETOR, acao: 'aprovado_diretor' };
    if (decisao === 'ajustar') return { novoStatus: STATUS.AJUSTE_SOLICITANTE, acao: 'ajuste_solicitado_diretor' };
    if (decisao === 'rejeitar') return { novoStatus: STATUS.REJEITADO, acao: 'rejeitado_diretor' };
    throw new Error('Decisão inválida. Use aprovar, ajustar ou rejeitar.');
}

// Financeiro inicia a análise da condição de pagamento (aprovado_diretor → em_analise_financeiro).
function validarIniciarAnaliseFinanceira({ solicitation, profile }) {
    if (!profile || (profile.role !== 'financeiro' && profile.role !== 'admin')) {
        throw new Error('Ação restrita ao financeiro.');
    }
    if (solicitation.status !== STATUS.APROVADO_DIRETOR) {
        throw new Error('Esta requisição ainda não foi aprovada pelo diretor comercial.');
    }
    return { novoStatus: STATUS.EM_ANALISE_FINANCEIRO, acao: 'analise_financeira' };
}

// Decisão final do financeiro (condição de pagamento).
function validarDecisaoFinanceiro({ solicitation, profile, decisao }) {
    if (!profile || (profile.role !== 'financeiro' && profile.role !== 'admin')) {
        throw new Error('Ação restrita ao financeiro.');
    }
    if (solicitation.status !== STATUS.EM_ANALISE_FINANCEIRO) {
        throw new Error('Esta requisição não está em análise do financeiro.');
    }
    if (decisao === 'aprovar') return { novoStatus: STATUS.APROVADO, acao: 'aprovado' };
    if (decisao === 'ajustar') return { novoStatus: STATUS.AJUSTE_PAGAMENTO, acao: 'ajuste_pagamento_solicitado' };
    if (decisao === 'rejeitar') return { novoStatus: STATUS.REJEITADO, acao: 'rejeitado' };
    throw new Error('Decisão inválida. Use aprovar, ajustar ou rejeitar.');
}

// Reenvio depois de ajuste de pagamento — volta direto para o financeiro
// (não precisa passar pelo CEO/diretor de novo: o escopo já foi aprovado,
// só a condição de pagamento mudou).
function validarReenviarFinanceiro({ solicitation, profile }) {
    if (!profile || (solicitation.requester_id !== profile.id && profile.role !== 'admin')) {
        throw new Error('Apenas o solicitante (ou um admin) pode reenviar esta requisição.');
    }
    if (solicitation.status !== STATUS.AJUSTE_PAGAMENTO) {
        throw new Error('Esta requisição não está aguardando ajuste de pagamento.');
    }
    return { novoStatus: STATUS.EM_ANALISE_FINANCEIRO, acao: 'reenviado_financeiro' };
}

function validarCancelar({ solicitation, profile }) {
    if (!podeCancelar(solicitation, profile)) {
        throw new Error('Você não tem permissão para cancelar esta requisição.');
    }
    return { novoStatus: STATUS.CANCELADO, acao: 'cancelado' };
}

module.exports = {
    STATUS,
    CEO_EMAIL,
    isCeoAprovador,
    papelDoUsuario,
    podeEditar,
    podeCancelar,
    validarEnviar,
    validarDecisaoCeo,
    validarDecisaoDiretor,
    validarIniciarAnaliseFinanceira,
    validarDecisaoFinanceiro,
    validarReenviarFinanceiro,
    validarCancelar,
};
