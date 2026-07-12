const { normalizarPlanoPagamento, validarPlanoPagamentoSalvo, roundMoney } = require('./paymentPlan');

function cnpjFiliais() {
    return {
        PICARRAS: (process.env.CNPJ_PICARRAS || '').replace(/\D/g, ''),
        BRASILIA: (process.env.CNPJ_BRASILIA || '').replace(/\D/g, ''),
        SAOPAULO: (process.env.CNPJ_SAOPAULO || '').replace(/\D/g, ''),
        FLORIANOPOLIS: (process.env.CNPJ_FLORIANOPOLIS || '').replace(/\D/g, ''),
        SALVADOR: (process.env.CNPJ_SALVADOR || '').replace(/\D/g, ''),
    };
}

function calcularTotalCarrinho(itens = []) {
    return roundMoney(itens.reduce((sum, item) => {
        const quantidade = Number(item.quantidade || 0);
        const preco = Number(item.preco_unitario || item.preco_original || item.preco || 0);
        return sum + (quantidade * preco);
    }, 0));
}

// Teto de sanidade por item — evita erro de digitação virar pedido (já houve
// pedido real com quantidade 28.300 de um item). Ajustável via .env.
const QTD_MAXIMA_POR_ITEM = () => Number(process.env.CHECKOUT_QTD_MAX_ITEM || 1000);

function validarItens(itens = []) {
    if (!Array.isArray(itens) || itens.length === 0) {
        throw new Error('Unidade e itens são obrigatórios');
    }

    const invalidos = itens.filter(item => {
        return !item.codigo || Number(item.quantidade || 0) <= 0 || Number(item.preco_unitario || item.preco_original || item.preco || 0) <= 0;
    });
    if (invalidos.length > 0) {
        throw new Error('Todos os itens precisam de código, quantidade positiva e preço unitário positivo.');
    }

    const qtdMax = QTD_MAXIMA_POR_ITEM();
    const acimaDoTeto = itens.filter(item => Number(item.quantidade || 0) > qtdMax);
    if (acimaDoTeto.length > 0) {
        const lista = acimaDoTeto.map(i => `${i.codigo} (${i.quantidade})`).join('; ');
        throw new Error(`Quantidade acima do limite de ${qtdMax} por item: ${lista}. Verifique se não houve erro de digitação.`);
    }
}

function validarCheckoutPreflight(body = {}) {
    const { unidade, itens, finalidade, pedidoVendaRef, contratoRef, pagamento, idempotencyKey } = body;

    if (!unidade) {
        throw new Error('Unidade e itens são obrigatórios');
    }
    validarItens(itens);

    if (finalidade === 'Revenda' && !pedidoVendaRef) {
        throw new Error('Informe um Pedido de Venda válido para liberar compras de revenda.');
    }
    if (finalidade === 'Atendimento a Contrato' && !contratoRef) {
        throw new Error('Informe um Contrato válido com tag de peças para liberar atendimento a contrato.');
    }

    if (!pagamento || typeof pagamento !== 'object') {
        throw new Error('Informe a forma de pagamento do pedido antes de finalizar.');
    }

    const cnpjs = cnpjFiliais();
    const cnpjEscamax = cnpjs[unidade] || '';
    const cnpjVP = (process.env.CNPJ_VP || '').replace(/\D/g, '');
    if (!cnpjEscamax) {
        throw new Error(`Unidade "${unidade}" não configurada. Verifique o CNPJ no .env.`);
    }
    if (!cnpjVP) {
        throw new Error('CNPJ da VerticalParts não configurado no .env.');
    }

    const totalCarrinho = calcularTotalCarrinho(itens);
    const planoPagamento = normalizarPlanoPagamento(pagamento, totalCarrinho);
    validarPlanoPagamentoSalvo(planoPagamento, totalCarrinho);

    return {
        ok: true,
        unidade,
        idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : null,
        finalidade: finalidade || null,
        totalCarrinho,
        cnpjEscamaxConfigurado: true,
        cnpjVPConfigurado: true,
        planoPagamento: {
            total: planoPagamento.total,
            qtdeParcelas: planoPagamento.qtdeParcelas,
            codigoParcela: planoPagamento.codigoParcela,
            parcelas: planoPagamento.parcelas,
        },
        payloadsOmie: {
            compraEscamax: {
                cCodParc: planoPagamento.omieCompra.cCodParc,
                nQtdeParc: planoPagamento.omieCompra.nQtdeParc,
                parcelas: planoPagamento.omieCompra.parcelas_incluir.length,
            },
            vendaVerticalParts: {
                codigo_parcela: planoPagamento.omieVenda.codigo_parcela,
                qtde_parcelas: planoPagamento.omieVenda.qtde_parcelas,
                parcelas: planoPagamento.omieVenda.lista_parcelas.parcela.length,
            },
        },
    };
}

module.exports = {
    cnpjFiliais,
    calcularTotalCarrinho,
    validarCheckoutPreflight,
};
