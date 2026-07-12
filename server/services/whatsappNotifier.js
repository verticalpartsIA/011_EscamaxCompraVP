const fetch = require('../utils/fetchComKeepAlive');
const logger = require('../utils/logger');
const { ALCADAS_PRODUTOS } = require('./approvalEngine');

// Aviso unidirecional (site -> WhatsApp) de pedidos aguardando aprovação.
// Reaproveita a mesma instância Evolution já pareada do VP Pós-Venda 360
// (mesmo VPS, mesmo número) — aqui só como canal de saída, sem nenhuma
// lógica de conversa/resposta. Nunca deve travar o fluxo de checkout/decisão
// se o WhatsApp estiver fora do ar.
const EVO_URL = () => process.env.EVOLUTION_URL || 'http://72.61.48.156:8080';
const EVO_INSTANCE = () => process.env.EVOLUTION_INSTANCE || 'pv360';
const EVO_APIKEY = () => process.env.EVOLUTION_APIKEY || '';

const FONE_POR_NIVEL = {
    1: () => process.env.WHATSAPP_FONE_GUSTAVO,
    2: () => process.env.WHATSAPP_FONE_MICHEL,
    3: () => process.env.WHATSAPP_FONE_DIEGO,
};

function papelPorNivel(nivel) {
    return ALCADAS_PRODUTOS.find(a => a.nivel === Number(nivel))?.papel || `Nível ${nivel}`;
}

function linkPortal(caminho = '/aprovacoes') {
    const base = process.env.FRONTEND_URL || 'https://escamaxcompravp.vpsistema.com';
    return `${base}${caminho}`;
}

async function enviarWhatsapp(numero, texto, { tries = 2 } = {}) {
    if (!numero) {
        logger.warn('[whatsapp] Número de destino não configurado — aviso não enviado.');
        return { ok: false, error: 'numero_nao_configurado' };
    }
    if (!EVO_APIKEY()) {
        logger.error('[whatsapp] EVOLUTION_APIKEY não configurado no .env — aviso não enviado.');
        return { ok: false, error: 'apikey_nao_configurada' };
    }

    let lastErr = 'sem tentativa';
    for (let i = 0; i < tries; i++) {
        try {
            const r = await fetch(`${EVO_URL()}/message/sendText/${EVO_INSTANCE()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: EVO_APIKEY() },
                body: JSON.stringify({ number: numero, text: texto }),
                timeout: 15_000,
            });
            if (r.ok) return { ok: true };
            lastErr = `HTTP ${r.status}`;
            // 4xx (ex.: número inválido) não melhora repetindo
            if (r.status >= 400 && r.status < 500) {
                logger.error(`[whatsapp] sendText ${lastErr}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
                return { ok: false, error: lastErr };
            }
        } catch (e) {
            lastErr = e.message;
        }
        if (i < tries - 1) await new Promise(resolve => setTimeout(resolve, 800 * (i + 1)));
    }
    logger.error(`[whatsapp] sendText falhou para ${numero}: ${lastErr}`);
    return { ok: false, error: lastErr };
}

// Avisa o aprovador da alçada indicada que há um pedido esperando decisão dele.
async function avisarNovaAprovacao({ nivel, orderId, unidade, valorTotal }) {
    const numero = FONE_POR_NIVEL[Number(nivel)]?.();
    const papel = papelPorNivel(nivel);
    const texto = [
        `📦 *Portal Escamax* — pedido aguardando aprovação (${papel})`,
        `Unidade: ${unidade || '-'}`,
        `Pedido: ${orderId}`,
        `Valor: R$ ${Number(valorTotal || 0).toFixed(2)}`,
        linkPortal(),
    ].join('\n');
    const resultado = await enviarWhatsapp(numero, texto);
    if (!resultado.ok) {
        logger.warn(`[whatsapp] Aviso de aprovação (nível ${nivel}, pedido ${orderId}) não enviado: ${resultado.error}`);
    }
    return resultado;
}

// Aviso de acompanhamento para o Diego (alçada máxima) sempre que Gustavo ou Michel
// aprovarem uma etapa de um pedido — independente de o fluxo já ter terminado ou de o
// próprio Diego ser o próximo aprovador da fila (esse último caso já recebe o aviso de
// avisarNovaAprovacao em separado).
async function avisarAprovacaoParaDiego({ nivel, orderId, unidade, valorTotal, aprovadoPor }) {
    const numero = process.env.WHATSAPP_FONE_DIEGO;
    const papel = papelPorNivel(nivel);
    const texto = [
        `👀 *Portal Escamax* — acompanhamento de aprovação`,
        `${papel} (${aprovadoPor || '-'}) acaba de aprovar uma etapa de compra.`,
        `Unidade: ${unidade || '-'}`,
        `Pedido: ${orderId}`,
        `Valor: R$ ${Number(valorTotal || 0).toFixed(2)}`,
        linkPortal(),
    ].join('\n');
    const resultado = await enviarWhatsapp(numero, texto);
    if (!resultado.ok) {
        logger.warn(`[whatsapp] Aviso de acompanhamento para Diego (nível ${nivel}, pedido ${orderId}) não enviado: ${resultado.error}`);
    }
    return resultado;
}

// ─── Requisição de Serviços (contratação de terceirizado) ────────────────────
// Mesmo canal Evolution, papéis próprios do módulo: CEO (gate obrigatório),
// diretor comercial e financeiro. Fones dedicados no .env — CEO tem fallback
// pro fone do Diego, já que ele é o aprovador designado hoje.
const FONE_SERVICOS = {
    ceo: () => process.env.WHATSAPP_FONE_SERVICOS_CEO || process.env.WHATSAPP_FONE_DIEGO,
    diretor: () => process.env.WHATSAPP_FONE_SERVICOS_DIRETOR || process.env.WHATSAPP_FONE_MICHEL,
    financeiro: () => process.env.WHATSAPP_FONE_SERVICOS_FINANCEIRO,
};

function linkServico(id) {
    return linkPortal(`/requisicao-servicos/${id}`);
}

async function avisarServicoAguardandoCeo({ id, titulo, filial, valorTotal }) {
    const texto = [
        `🔒 *Portal Escamax* — Requisição de Serviço aguardando SEU aval (CEO)`,
        `Título: ${titulo || '-'}`,
        `Filial: ${filial || '-'}`,
        `Valor estimado: R$ ${Number(valorTotal || 0).toFixed(2)}`,
        linkServico(id),
    ].join('\n');
    const resultado = await enviarWhatsapp(FONE_SERVICOS.ceo(), texto);
    if (!resultado.ok) logger.warn(`[whatsapp] Aviso de gate CEO (serviço ${id}) não enviado: ${resultado.error}`);
    return resultado;
}

async function avisarServicoAnaliseDiretor({ id, titulo, filial, valorTotal }) {
    const texto = [
        `📋 *Portal Escamax* — Requisição de Serviço liberada pelo CEO, aguardando análise comercial`,
        `Título: ${titulo || '-'}`,
        `Filial: ${filial || '-'}`,
        `Valor estimado: R$ ${Number(valorTotal || 0).toFixed(2)}`,
        linkServico(id),
    ].join('\n');
    const resultado = await enviarWhatsapp(FONE_SERVICOS.diretor(), texto);
    if (!resultado.ok) logger.warn(`[whatsapp] Aviso de análise diretor (serviço ${id}) não enviado: ${resultado.error}`);
    return resultado;
}

async function avisarServicoAnaliseFinanceira({ id, titulo, filial, valorTotal }) {
    const texto = [
        `💰 *Portal Escamax* — Requisição de Serviço aprovada pelo diretor, aguardando análise financeira`,
        `Título: ${titulo || '-'}`,
        `Filial: ${filial || '-'}`,
        `Valor estimado: R$ ${Number(valorTotal || 0).toFixed(2)}`,
        linkServico(id),
    ].join('\n');
    const resultado = await enviarWhatsapp(FONE_SERVICOS.financeiro(), texto);
    if (!resultado.ok) logger.warn(`[whatsapp] Aviso de análise financeira (serviço ${id}) não enviado: ${resultado.error}`);
    return resultado;
}

module.exports = {
    enviarWhatsapp,
    avisarNovaAprovacao,
    avisarAprovacaoParaDiego,
    linkPortal,
    avisarServicoAguardandoCeo,
    avisarServicoAnaliseDiretor,
    avisarServicoAnaliseFinanceira,
};
