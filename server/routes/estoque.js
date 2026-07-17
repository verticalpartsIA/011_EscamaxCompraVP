const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { listarEstoqueVPCompleto, listarEstoqueEscamax } = require('../services/estoqueService');
const logger = require('../utils/logger');

// GET /api/estoque/vp — saldo de todos os códigos rastreados na VerticalParts.
// Único caminho de leitura de estoque_vp desde que a policy de leitura pública
// foi removida (issue #48).
router.get('/vp', authMiddleware, async (req, res) => {
    try {
        const rows = await listarEstoqueVPCompleto();
        res.json(rows);
    } catch (err) {
        logger.error(`[estoque/vp] Erro: ${err.message}`);
        res.status(500).json({ error: 'Erro ao consultar estoque VerticalParts.' });
    }
});

// GET /api/estoque/escamax?unidade=SAOPAULO — estoque da filial na Escamax.
router.get('/escamax', authMiddleware, async (req, res) => {
    const { unidade } = req.query;
    if (!unidade) return res.status(400).json({ error: 'Parâmetro unidade é obrigatório.' });
    try {
        const rows = await listarEstoqueEscamax(unidade);
        res.json(rows);
    } catch (err) {
        logger.error(`[estoque/escamax] Erro: ${err.message}`);
        res.status(500).json({ error: 'Erro ao consultar estoque Escamax.' });
    }
});

module.exports = router;
