const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const { listarUsuarios, convidarUsuario, buscarUsuarioPorEmail } = require('../services/usuariosService');
const { registrarLog } = require('../services/auditoriaService');

router.use(authMiddleware);

// GET /api/usuarios/me — perfil do usuário logado (qualquer usuário autenticado)
router.get('/me', async (req, res) => {
    try {
        const usuario = await buscarUsuarioPorEmail(req.user?.email);
        if (!usuario) return res.status(404).json({ error: 'Perfil não encontrado.' });
        res.json(usuario);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/usuarios — lista todos (admin)
router.get('/', adminMiddleware, async (req, res) => {
    try {
        res.json(await listarUsuarios());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/usuarios/convidar — envia convite por e-mail (admin)
router.post('/convidar', adminMiddleware, async (req, res) => {
    const { email, nome, empresa, isAdmin, alcadaNivel } = req.body;
    if (!email || !nome || !empresa) {
        return res.status(400).json({ error: 'Informe e-mail, nome e empresa.' });
    }
    try {
        const resultado = await convidarUsuario({
            email, nome, empresa,
            isAdmin: Boolean(isAdmin),
            alcadaNivel: alcadaNivel ? Number(alcadaNivel) : null,
            convidadoPor: req.user?.email,
        });
        await registrarLog({
            usuarioEmail: req.user?.email,
            acao: 'usuario.convidado',
            detalhes: { email, nome, empresa, isAdmin: Boolean(isAdmin), alcadaNivel: alcadaNivel || null, ...resultado },
        });
        res.json(resultado);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
