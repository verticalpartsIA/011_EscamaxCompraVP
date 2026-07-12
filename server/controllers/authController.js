const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { autenticarComSenha, buscarUsuarioPorEmail, normalizarEmail } = require('../services/usuariosService');
const { registrarLog } = require('../services/auditoriaService');

// Rate-limit de login em memória: N falhas seguidas para o mesmo e-mail dentro
// da janela → bloqueio temporário (mitiga força bruta/sondagem de credenciais).
// Em memória basta: o backend roda em processo único (Passenger) e um restart
// zerar o contador não é um problema de segurança relevante aqui.
const MAX_FALHAS_LOGIN = Number(process.env.LOGIN_MAX_FALHAS || 5);
const JANELA_FALHAS_MS = Number(process.env.LOGIN_JANELA_MINUTOS || 15) * 60 * 1000;
const falhasLogin = new Map(); // email -> { count, primeiraFalhaEm }

function loginBloqueado(email) {
    const registro = falhasLogin.get(email);
    if (!registro) return false;
    if (Date.now() - registro.primeiraFalhaEm > JANELA_FALHAS_MS) {
        falhasLogin.delete(email);
        return false;
    }
    return registro.count >= MAX_FALHAS_LOGIN;
}

function registrarFalhaLogin(email) {
    const agora = Date.now();
    const registro = falhasLogin.get(email);
    if (!registro || agora - registro.primeiraFalhaEm > JANELA_FALHAS_MS) {
        falhasLogin.set(email, { count: 1, primeiraFalhaEm: agora });
    } else {
        registro.count++;
    }
}

// Login por e-mail + senha (Supabase Auth). Só usuários com perfil ativo em
// `usuarios` (cadastrados via convite) recebem o token do portal — a conta
// existir no Supabase Auth não é suficiente por si só.
exports.login = async (req, res) => {
    const { email, senha } = req.body;
    const emailNormalizado = normalizarEmail(email);

    if (!emailNormalizado || !senha) {
        return res.status(400).json({ error: 'Informe e-mail e senha.' });
    }

    if (loginBloqueado(emailNormalizado)) {
        logger.warn(`[auth] Login bloqueado por excesso de tentativas: ${emailNormalizado}`);
        await registrarLog({ usuarioEmail: emailNormalizado, acao: 'login.bloqueado', detalhes: { motivo: 'excesso_tentativas' } });
        return res.status(429).json({ error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' });
    }

    try {
        await autenticarComSenha(emailNormalizado, senha);
    } catch (err) {
        registrarFalhaLogin(emailNormalizado);
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

    falhasLogin.delete(emailNormalizado);
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
