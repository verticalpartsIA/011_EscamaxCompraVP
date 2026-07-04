const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { readOrders } = require('../services/orderStore');
const { confirmarEntregaPedido } = require('../services/deliveryConfirmation');

function localizarPedido(orders, { codigoPedidoOmie, numeroPedidoVenda }) {
    return orders.find(order => {
        const codigo = order.pedido_venda?.codigo || order.pedido_venda?.codigo_integracao;
        const numero = order.pedido_venda?.numero;
        return (codigoPedidoOmie && String(codigo) === String(codigoPedidoOmie))
            || (numeroPedidoVenda && String(numero) === String(numeroPedidoVenda));
    }) || null;
}

// POST /api/webhooks/sac/entrega-confirmada
// Chamado pelo SAC Pós-Venda 360 (verticalpartsIA/004_sac_posvenda360) quando o
// operador confirma a entrega física (data_entrega_real) na tela de Expedição.
// Move automaticamente o Pedido de Venda VP para a etapa "Faturar" no Omie,
// sem depender de um clique manual no portal Escamax.
router.post('/entrega-confirmada', async (req, res) => {
    const secretEsperado = process.env.SAC_DELIVERY_WEBHOOK_SECRET;
    const secretRecebido = req.get('x-integration-secret');

    if (!secretEsperado) {
        logger.error('[webhooks/sac] SAC_DELIVERY_WEBHOOK_SECRET não configurado no .env — webhook bloqueado.');
        return res.status(500).json({ error: 'Webhook não configurado no servidor.' });
    }
    if (secretRecebido !== secretEsperado) {
        logger.warn('[webhooks/sac] tentativa com x-integration-secret inválido ou ausente.');
        return res.status(401).json({ error: 'Não autorizado.' });
    }

    const { codigo_pedido_omie, numero_pedido_venda, nf_numero, data_entrega_real } = req.body || {};
    if (!codigo_pedido_omie && !numero_pedido_venda) {
        return res.status(400).json({
            error: 'Informe codigo_pedido_omie ou numero_pedido_venda para localizar o pedido Escamax.',
        });
    }

    const orders = readOrders();
    const order = localizarPedido(orders, { codigoPedidoOmie: codigo_pedido_omie, numeroPedidoVenda: numero_pedido_venda });
    if (!order) {
        logger.warn(`[webhooks/sac] pedido não localizado (codigo_pedido_omie=${codigo_pedido_omie}, numero_pedido_venda=${numero_pedido_venda})`);
        return res.status(404).json({ error: 'Pedido Escamax não localizado para este código/número de venda VP.' });
    }

    try {
        const resultado = await confirmarEntregaPedido(order.id, {
            origem: 'sac_pv360',
            detalhe: `NF ${nf_numero || '-'} · entrega confirmada em ${data_entrega_real || new Date().toISOString().slice(0, 10)} (SAC Pós-Venda 360)`,
        });
        logger.info(`[webhooks/sac] pedido ${order.id} movido para Faturar via SAC Pós-Venda 360 (NF ${nf_numero || '-'})`);
        return res.json({ ok: true, ...resultado });
    } catch (err) {
        const detail = err.response?.data?.faultstring || err.response?.data?.message || err.message;
        logger.error(`[webhooks/sac] erro ao confirmar entrega do pedido ${order.id}: ${detail}`);
        return res.status(err.status || 500).json({ error: detail });
    }
});

module.exports = router;
