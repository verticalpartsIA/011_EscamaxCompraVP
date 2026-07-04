const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { autenticarComSenha, buscarUsuarioPorEmail, normalizarEmail } = require('../services/usuariosService');
const { registrarLog } = require('../services/auditoriaService');

// Login por e-mail + senha (Supabase Auth). Só usuários com perfil ativo em
// `usuarios` (cadastrados via convite) recebem o token do portal — a conta
// existir no Supabase Auth não é suficiente por si só.
exports.login = async (req, res) => {
    const { email, senha } = req.body;
    const emailNormalizado = normalizarEmail(email);

    if (!emailNormalizado || !senha) {
        return res.status(400).json({ error: 'Informe e-mail e senha.' });
    }

    try {
        await autenticarComSenha(emailNormalizado, senha);
    } catch (err) {
        logger.warn(`[auth] Falha de login para ${emailNormalizado}: ${err.message}`);
        await registrarLog({ usuarioEmail: emailNormalizado, acao: 'login.falhou', detalhes: { motivo: err.message } });
        return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }

    const usuario = await buscarUsuarioPorEmail(emailNormalizado);
    if (!usuario || !usuario.ativo) {
        logger.warn(`[auth] Login negado (sem perfil ativo): ${emailNormalizado}`);
        await registrarLog({ usuarioEmail: emailNormalizado, acao: 'login.negado', detalhes: { motivo: 'sem_perfil_ativo' } });
        return res.status(403).json({ error: 'Acesso não autorizado. Peça um convite ao administrador.' });
    }

    const token = jwt.sign({ email: emailNormalizado }, process.env.JWT_SECRET, { expiresIn: '8h' });

    logger.info(`[auth] Login bem-sucedido: ${emailNormalizado}`);
    await registrarLog({ usuarioEmail: emailNormalizado, acao: 'login.sucesso' });

    return res.json({
        token,
        user: {
            email: usuario.email,
            nome: usuario.nome,
            empresa: usuario.empresa,
            admin: usuario.is_admin,
            alcadaNivel: usuario.alcada_nivel,
        },
    });
};
