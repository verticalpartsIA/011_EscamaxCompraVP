const { buscarUsuarioPorEmail } = require('../services/usuariosService');

// Deve ser usado depois de authMiddleware (precisa de req.user.email já definido).
async function adminMiddleware(req, res, next) {
    const usuario = await buscarUsuarioPorEmail(req.user?.email);
    if (!usuario || !usuario.ativo || !usuario.is_admin) {
        return res.status(403).json({ error: 'Ação restrita a administradores.' });
    }
    req.usuarioAtual = usuario;
    next();
}

module.exports = adminMiddleware;
