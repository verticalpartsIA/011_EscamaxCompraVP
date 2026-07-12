const express = require('express');
const router = express.Router();
const fetch = require('../utils/fetchComKeepAlive');
const authMiddleware = require('../middleware/authMiddleware');
const { sincronizarFilial, sincronizarTodasFiliais, FILIAIS } = require('../services/comprasHistoricoSync');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

router.use(authMiddleware);

// GET /api/compras-historico?unidade=SAOPAULO — isolado por filial, nunca global
router.get('/', async (req, res) => {
    const unidade = String(req.query.unidade || '').toUpperCase();
    if (!FILIAIS.includes(unidade)) {
        return res.status(400).json({ error: `Filial inválida ou ausente. Use uma de: ${FILIAIS.join(', ')}` });
    }

    try {
        const resp = await fetch(
            `${SUPABASE_URL}/rest/v1/compras_historico_vp?filial=eq.${unidade}&data_pedido=gte.2024-01-01&select=numero_pedido,codigo_produto,descricao,valor,data_pedido&order=data_pedido.desc&limit=2000`,
            {
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                },
            }
        );
        if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
        const data = await resp.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: `Erro ao consultar histórico de compras: ${err.message}` });
    }
});

// POST /api/compras-historico/sync?unidade=SAOPAULO  (ou sem unidade = todas)
router.post('/sync', async (req, res) => {
    const unidade = req.query.unidade ? String(req.query.unidade).toUpperCase() : null;
    try {
        if (unidade) {
            if (!FILIAIS.includes(unidade)) {
                return res.status(400).json({ error: `Filial inválida. Use uma de: ${FILIAIS.join(', ')}` });
            }
            const resultado = await sincronizarFilial(unidade);
            return res.json(resultado);
        }
        const resultados = await sincronizarTodasFiliais();
        res.json(resultados);
    } catch (err) {
        res.status(500).json({ error: `Erro ao sincronizar histórico de compras: ${err.message}` });
    }
});

module.exports = router;
