const omieClient = require('./omieClient');
const { readOrders, updateOrder } = require('./orderStore');
const { validarPlanoPagamentoSalvo } = require('./paymentPlan');
const { etapaVendaProdutoVP, registrarSincronizacaoEtapa } = require('./omieStages');
const { criarFluxoAprovacaoProdutos, confirmarEntrega } = require('./approvalEngine');

function calcularValorPedido(order) {
    return (order.itens || []).reduce((acc, item) => {
        return acc + (Number(item.quantidade || 0) * Number(item.preco_unitario || item.preco || 0));
    }, 0);
}

function ensureAprovacao(order) {
    if (order.aprovacao) return order.aprovacao;
    return criarFluxoAprovacaoProdutos({
        valorTotal: calcularValorPedido(order),
        origem: 'historico',
    });
}

function erro(mensagem, status) {
    const e = new Error(mensagem);
    e.status = status;
    return e;
}

// Move o Pedido de Venda VP para a etapa Faturar no Omie.
// Chamada tanto pelo botão manual (portal, alçada de faturamento) quanto pelo
// webhook do SAC Pós-Venda 360 (confirmação automática de entrega física).
async function confirmarEntregaPedido(orderId, { origem = 'manual_portal', detalhe = null } = {}) {
    const orders = readOrders();
    const order = orders.find(item => item.id === orderId);
    if (!order) throw erro('Pedido não encontrado.', 404);

    const aprovacao = ensureAprovacao(order);
    if (aprovacao.status !== 'aprovado') {
        throw erro('Entrega bloqueada: o pedido ainda não concluiu todas as alçadas de aprovação.', 409);
    }

    const etapaFaturar = etapaVendaProdutoVP('FATURAR');
    if (order.pedido_venda?.etapa === etapaFaturar.codigo) {
        // Idempotente: já está em Faturar (ex.: webhook duplicado do SAC).
        return { id: order.id, pedido_venda: order.pedido_venda, aprovacao: order.aprovacao, jaConfirmado: true };
    }

    validarPlanoPagamentoSalvo(order.planoPagamento, calcularValorPedido(order));

    const codigoPedido = order.pedido_venda?.codigo;
    const codigoPedidoIntegracao = order.pedido_venda?.codigo_integracao;
    if (!codigoPedido && !codigoPedidoIntegracao) {
        throw erro('Pedido de venda sem código interno/integrado da Omie para enviar à etapa Faturar.', 400);
    }

    const omie = await omieClient.marcarPedidoVendaVPParaFaturar({ codigoPedido, codigoPedidoIntegracao });

    const updated = updateOrder(orderId, current => {
        current.aprovacao = confirmarEntrega(ensureAprovacao(current), { origem, detalhe });
        current = registrarSincronizacaoEtapa(current, {
            origem: origem === 'sac_pv360' ? 'sac.entrega_confirmada' : 'produto.entregue',
            etapaLocal: current.aprovacao.etapaAtual,
            etapaOmie: etapaFaturar,
            resultado: omie,
        });
        current.pedido_venda.faturar_em = new Date().toISOString();
        current.financeiro = {
            ...(current.financeiro || {}),
            notificado: true,
            notificadoEm: new Date().toISOString(),
            origemConfirmacao: origem,
            detalheConfirmacao: detalhe,
            mensagem: origem === 'sac_pv360'
                ? 'Entrega confirmada automaticamente pelo SAC Pós-Venda 360. Faturamento solicitado para a VerticalParts.'
                : 'Pedido entregue. Faturamento solicitado automaticamente para a VerticalParts.',
        };
        return current;
    });

    return { id: updated.id, pedido_venda: updated.pedido_venda, aprovacao: updated.aprovacao, omie };
}

module.exports = { confirmarEntregaPedido };
