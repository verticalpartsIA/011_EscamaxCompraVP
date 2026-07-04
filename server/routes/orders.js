const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const omieClient = require('../services/omieClient');
const { readOrders, findOrder, updateOrder } = require('../services/orderStore');
const { validarPlanoPagamentoSalvo } = require('../services/paymentPlan');
const { etapaVendaProdutoVP, registrarSincronizacaoEtapa, registrarErroSincronizacaoEtapa } = require('../services/omieStages');
const { montarAuditoriaOmie, montarAuditoriaErro } = require('../services/omieAudit');
const { confirmarEntregaPedido } = require('../services/deliveryConfirmation');
const { registrarLog } = require('../services/auditoriaService');
const { avisarNovaAprovacao } = require('../services/whatsappNotifier');
const logger = require('../utils/logger');
const {
    criarFluxoAprovacaoProdutos,
    registrarDecisao,
    obterPermissoesAprovacao,
    validarAprovador,
    validarFaturamento,
} = require('../services/approvalEngine');

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

function withAprovacao(order) {
    return {
        ...order,
        aprovacao: ensureAprovacao(order),
    };
}

// GET /api/orders/stats — agregação por mês (sem filtro de data)
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const orders = await readOrders();

        const byMonth = {};
        let totalGeral = 0;
        let totalPedidos = 0;

        for (const order of orders) {
            const mes = order.criadoEm?.slice(0, 7) || 'desconhecido'; // YYYY-MM
            if (!byMonth[mes]) {
                byMonth[mes] = { mes, pedidos: 0, valor: 0, ok: 0, erro: 0 };
            }

            const valorPedido = (order.itens || []).reduce((acc, item) => {
                return acc + (Number(item.quantidade || 0) * Number(item.preco_unitario || 0));
            }, 0);

            const compraOk = order.pedido_compra?.status === 'ok';
            const vendaOk = order.pedido_venda?.status === 'ok';

            byMonth[mes].pedidos += 1;
            byMonth[mes].valor += valorPedido;
            byMonth[mes].ok += (compraOk && vendaOk) ? 1 : 0;
            byMonth[mes].erro += (!compraOk || !vendaOk) ? 1 : 0;

            totalGeral += valorPedido;
            totalPedidos += 1;
        }

        // Ordena por mês crescente
        const meses = Object.values(byMonth).sort((a, b) => a.mes.localeCompare(b.mes));

        res.json({ meses, totalGeral, totalPedidos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/orders?de=YYYY-MM-DD&ate=YYYY-MM-DD
router.get('/', authMiddleware, async (req, res) => {
    try {
        let orders = await readOrders();

        const { de, ate } = req.query;
        if (de) {
            const [y, m, d] = de.split('-').map(Number);
            const from = new Date(y, m - 1, d, 0, 0, 0, 0);
            orders = orders.filter(o => new Date(o.criadoEm) >= from);
        }
        if (ate) {
            const [y, m, d] = ate.split('-').map(Number);
            const to = new Date(y, m - 1, d, 23, 59, 59, 999);
            orders = orders.filter(o => new Date(o.criadoEm) <= to);
        }

        // Mais recentes primeiro
        orders.sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

        res.json(orders.map(withAprovacao));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/aprovacoes/permissoes', authMiddleware, async (req, res) => {
    try {
        res.json(await obterPermissoesAprovacao(req.user?.email));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id/aprovacao', authMiddleware, async (req, res) => {
    try {
        const order = await findOrder(req.params.id);
        if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

        const aprovacao = ensureAprovacao(order);
        res.json({ id: order.id, pedido_compra: order.pedido_compra, pedido_venda: order.pedido_venda, aprovacao });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/auditoria-omie', authMiddleware, async (req, res) => {
    try {
        const order = await findOrder(req.params.id);
        if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

        if (order.pedido_compra?.status !== 'ok' || order.pedido_venda?.status !== 'ok') {
            return res.status(409).json({
                error: 'Auditoria Omie bloqueada: compra e venda precisam estar criadas com sucesso.',
            });
        }

        if (!order.planoPagamento) {
            return res.status(409).json({
                error: 'Auditoria Omie bloqueada: pedido sem plano de pagamento salvo.',
            });
        }

        try {
            const [consultaCompra, consultaVenda] = await Promise.all([
                omieClient.consultarPedidoCompra({
                    unidade: order.unidade,
                    numero: order.pedido_compra.numero,
                    codigo: order.pedido_compra.codigo,
                    codigoIntegracao: order.pedido_compra.codigo_integracao,
                }),
                omieClient.consultarPedidoVendaVP({
                    codigoPedido: order.pedido_venda.codigo,
                    codigoPedidoIntegracao: order.pedido_venda.codigo_integracao,
                }),
            ]);
            const auditoria = montarAuditoriaOmie({ order, consultaCompra, consultaVenda });
            const updated = await updateOrder(req.params.id, current => ({
                ...current,
                auditoria_omie: auditoria,
            }));
            return res.json({ id: updated.id, auditoria_omie: updated.auditoria_omie });
        } catch (error) {
            const auditoria = montarAuditoriaErro(error);
            const updated = await updateOrder(req.params.id, current => ({
                ...current,
                auditoria_omie: auditoria,
            }));
            return res.status(202).json({ id: updated.id, auditoria_omie: updated.auditoria_omie });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/aprovacao/decisao', authMiddleware, async (req, res) => {
    try {
        const { nivel, decisao, motivo } = req.body;
        const usuario = req.user?.email || 'sistema';
        await validarAprovador(usuario, nivel);

        let aprovouFluxo = false;
        const updated = await updateOrder(req.params.id, order => {
            const aprovacao = ensureAprovacao(order);
            order.aprovacao = registrarDecisao(aprovacao, { nivel, decisao, usuario, motivo });
            aprovouFluxo = order.aprovacao.status === 'aprovado';
            return order;
        });

        if (!updated) return res.status(404).json({ error: 'Pedido não encontrado.' });

        await registrarLog({
            usuarioEmail: usuario,
            acao: String(decisao).toLowerCase() === 'reprovar' ? 'pedido.reprovado' : 'pedido.alcada_aprovada',
            detalhes: { nivel, motivo },
            pedidoId: req.params.id,
        });

        if (String(decisao).toLowerCase() === 'aprovar' && !aprovouFluxo && updated.aprovacao?.alcadaAtual) {
            avisarNovaAprovacao({
                nivel: updated.aprovacao.alcadaAtual,
                orderId: updated.id,
                unidade: updated.unidade,
                valorTotal: calcularValorPedido(updated),
            }).catch(e => logger.warn(`[whatsapp] Falha ao avisar próxima alçada do pedido ${updated.id}: ${e.message}`));
        }

        if (!aprovouFluxo || updated.pedido_venda?.status !== 'ok') {
            return res.json({ id: updated.id, aprovacao: updated.aprovacao });
        }

        const etapaOperacional = etapaVendaProdutoVP('SEPARAR_ESTOQUE');
        let resultadoSync = { skipped: true, reason: 'Pedido VP já criado na etapa operacional de separação.' };

        const codigoPedido = updated.pedido_venda?.codigo;
        const codigoPedidoIntegracao = updated.pedido_venda?.codigo_integracao;
        let syncStatus = 'ok';

        if (updated.pedido_venda?.etapa !== etapaOperacional.codigo && (codigoPedido || codigoPedidoIntegracao)) {
            try {
                resultadoSync = await omieClient.trocarEtapaPedidoVendaVP({
                    codigoPedido,
                    codigoPedidoIntegracao,
                    etapa: etapaOperacional.codigo,
                });
            } catch (error) {
                syncStatus = 'erro';
                const syncedError = await updateOrder(req.params.id, current => registrarErroSincronizacaoEtapa(current, {
                    origem: 'aprovacao.final',
                    etapaLocal: current.aprovacao?.etapaAtual,
                    etapaOmie: etapaOperacional,
                    error,
                }));
                return res.status(202).json({
                    id: syncedError.id,
                    aprovacao: syncedError.aprovacao,
                    pedido_venda: syncedError.pedido_venda,
                    sync: {
                        status: syncStatus,
                        detalhe: syncedError.pedido_venda?.etapa_sync_detalhe,
                    },
                });
            }
        } else if (!codigoPedido && !codigoPedidoIntegracao) {
            resultadoSync = { skipped: true, reason: 'Pedido VP sem código interno/integrado salvo para sincronizar etapa operacional.' };
        }

        const synced = await updateOrder(req.params.id, current => registrarSincronizacaoEtapa(current, {
            origem: 'aprovacao.final',
            etapaLocal: current.aprovacao?.etapaAtual,
            etapaOmie: etapaOperacional,
            resultado: resultadoSync,
        }));

        res.json({ id: synced.id, aprovacao: synced.aprovacao, pedido_venda: synced.pedido_venda, sync: resultadoSync });
    } catch (err) {
        const status = /sem permissão/i.test(err.message || '') ? 403 : 400;
        res.status(status).json({ error: err.message });
    }
});

// Confirmação manual (override) — uso excepcional. O caminho normal é automático,
// disparado pelo webhook /api/webhooks/sac/entrega-confirmada quando o SAC Pós-Venda 360
// registra a entrega física da mercadoria.
router.post('/:id/confirmar-entrega', authMiddleware, async (req, res) => {
    try {
        await validarFaturamento(req.user?.email);

        if (req.body?.confirmarFaturamento !== true) {
            return res.status(400).json({
                error: 'Confirmação obrigatória: marque explicitamente que a entrega foi conferida e que o pedido VP pode ir para Faturar.',
            });
        }

        const resultado = await confirmarEntregaPedido(req.params.id, {
            origem: 'manual_portal',
            detalhe: `Confirmado manualmente por ${req.user?.email || 'usuário'} no portal Escamax.`,
        });

        await registrarLog({
            usuarioEmail: req.user?.email,
            acao: 'pedido.entrega_confirmada_manual',
            pedidoId: req.params.id,
        });

        res.json(resultado);
    } catch (err) {
        const detail = err.response?.data?.faultstring || err.response?.data?.message || err.message;
        const status = err.status || (/sem permissão/i.test(detail)
            ? 403
            : /Faturamento bloqueado/i.test(detail)
                ? 409
                : 500);
        res.status(status).json({
            error: status === 500 ? 'Erro ao confirmar entrega e mover pedido VP para Faturar.' : detail,
            detail,
        });
    }
});

module.exports = router;
