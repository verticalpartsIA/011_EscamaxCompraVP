const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const { listarLogs, adicionarObservacao, listarObservacoes } = require('../services/auditoriaService');
const { buscarUsuarioPorEmail, normalizarEmail } = require('../services/usuariosService');

router.use(authMiddleware);

const EMAIL_DIEGO = 'adm@escamax.com.br';

// GET /api/logs — lista de auditoria (admin)
router.get('/', adminMiddleware, async (req, res) => {
    try {
        const logs = await listarLogs({ pedidoId: req.query.pedidoId });
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/logs/:id/observacoes — thread de um log específico
router.get('/:id/observacoes', adminMiddleware, async (req, res) => {
    try {
        res.json(await listarObservacoes(req.params.id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/logs/:id/observacoes — inicia ou responde a thread (réplica/tréplica)
// Só o Diego (adm@escamax.com.br) pode INICIAR uma indagação num log; uma vez
// aberta, qualquer participante da thread (quem indagou ou quem foi indagado)
// pode responder, sem limite de rodadas.
router.post('/:id/observacoes', adminMiddleware, async (req, res) => {
    const { mensagem } = req.body;
    if (!String(mensagem || '').trim()) {
        return res.status(400).json({ error: 'Mensagem não pode ser vazia.' });
    }

    const emailAtual = normalizarEmail(req.user?.email);
    try {
        const existentes = await listarObservacoes(req.params.id);
        const isDiego = emailAtual === EMAIL_DIEGO;
        const jaParticipou = existentes.some(o => normalizarEmail(o.autor_email) === emailAtual);

        if (existentes.length === 0 && !isDiego) {
            return res.status(403).json({ error: 'Só o Diego pode abrir uma indagação em um log.' });
        }
        if (existentes.length > 0 && !isDiego && !jaParticipou) {
            return res.status(403).json({ error: 'Você não faz parte desta conversa.' });
        }

        const observacao = await adicionarObservacao({
            logId: req.params.id,
            autorEmail: emailAtual,
            mensagem,
        });
        res.json(observacao);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
