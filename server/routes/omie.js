const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { consultarPedidoVenda, consultarContratoAutorizado } = require('../services/omieClient');
const logger = require('../utils/logger');

const UNIDADES_VALIDAS = ['BRASILIA', 'FLORIANOPOLIS', 'PICARRAS', 'SALVADOR', 'SAOPAULO'];

// GET /api/omie/pedido-venda?numero=12345&unidade=SAOPAULO
router.get('/pedido-venda', authMiddleware, async (req, res) => {
    const { numero, unidade } = req.query;

    if (!numero || !unidade) {
        return res.status(400).json({ error: 'Parâmetros numero e unidade são obrigatórios' });
    }

    const unidadeUp = unidade.toUpperCase();
    if (!UNIDADES_VALIDAS.includes(unidadeUp)) {
        return res.status(400).json({ error: `Unidade inválida: ${unidade}` });
    }

    logger.info(`[omie/pedido-venda] Consultando pedido ${numero} na filial ${unidadeUp}`);

    try {
        const resultado = await consultarPedidoVenda(numero, unidadeUp);

        if (!resultado) {
            return res.status(404).json({
                error: `Pedido de venda nº ${numero} não encontrado na filial ${unidadeUp}`,
            });
        }

        if (!resultado.valorTotal || resultado.valorTotal <= 0) {
            return res.status(422).json({
                error: `Pedido de venda nº ${numero} encontrado, mas sem valor total positivo para calcular o limite de 70%.`,
            });
        }

        return res.json({
            valido: true,
            numero: resultado.numero,
            vendedor: resultado.vendedor,
            valorTotal: resultado.valorTotal,
            limiteCompra70: resultado.limiteCompra70,
        });
    } catch (err) {
        logger.error(`[omie/pedido-venda] Erro: ${err.message}`);
        return res.status(500).json({ error: `Erro ao consultar pedido no Omie: ${err.message}` });
    }
});

// GET /api/omie/contrato?numero=12345&unidade=SAOPAULO
router.get('/contrato', authMiddleware, async (req, res) => {
    const { numero, unidade } = req.query;

    if (!numero || !unidade) {
        return res.status(400).json({ error: 'Parâmetros numero e unidade são obrigatórios' });
    }

    const unidadeUp = unidade.toUpperCase();
    if (!UNIDADES_VALIDAS.includes(unidadeUp)) {
        return res.status(400).json({ error: `Unidade inválida: ${unidade}` });
    }

    logger.info(`[omie/contrato] Consultando contrato ${numero} na filial ${unidadeUp}`);

    try {
        const resultado = await consultarContratoAutorizado(numero, unidadeUp);

        if (!resultado) {
            return res.status(404).json({
                error: `Contrato nº ${numero} não encontrado na filial ${unidadeUp}`,
            });
        }

        if (!resultado.valido) {
            return res.status(422).json({
                error: '❌ Para essa modalidade de contrato não está autorizado a fazer o pedido.',
                numero: resultado.numero,
                categoria: resultado.categoria,
                categoriaDescricao: resultado.categoriaDescricao,
            });
        }

        return res.json(resultado);
    } catch (err) {
        logger.error(`[omie/contrato] Erro: ${err.message}`);
        return res.status(500).json({ error: `Erro ao consultar contrato no Omie: ${err.message}` });
    }
});

module.exports = router;
