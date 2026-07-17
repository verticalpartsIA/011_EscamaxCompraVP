const dotenv = require('dotenv');
const path = require('path');

// DEVE SER O PRIMEIRO REQUIRE - carrega o .env antes de qualquer outro módulo
dotenv.config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const logger = require('./utils/logger');
const authRoutes = require('./routes/auth');
const partsRoutes = require('./routes/parts');
const checkoutRoutes = require('./routes/checkout');
const ordersRoutes = require('./routes/orders');
const produtosVPRoutes = require('./routes/produtosVP');
const omieRoutes = require('./routes/omie');
const webhooksSacRoutes = require('./routes/webhooksSac');
const comprasHistoricoRoutes = require('./routes/comprasHistorico');
const usuariosRoutes = require('./routes/usuarios');
const logsRoutes = require('./routes/logs');
const servicosRoutes = require('./routes/servicos');
const estoqueRoutes = require('./routes/estoque');
const cron = require('node-cron');
const { syncOmieProdutos } = require('./services/omieVPSync');
const { sincronizarTodasFiliais } = require('./services/comprasHistoricoSync');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Request Logger
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url} - IP: ${req.ip}`);
    console.log(`[REQ] ${req.method} ${req.url}`);
    next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/parts', partsRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/produtos-vp', produtosVPRoutes);
app.use('/api/omie', omieRoutes);
app.use('/api/webhooks/sac', webhooksSacRoutes);
app.use('/api/compras-historico', comprasHistoricoRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/servicos', servicosRoutes);
app.use('/api/estoque', estoqueRoutes);

// Health Check — em produção o Passenger só roteia /api/* para este processo
// (ver public_html/.htaccess, PassengerBaseURI /api), então precisa viver
// sob /api para ser alcançável de fora.
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Final handler para 404
app.use((req, res) => {
    logger.warn(`404 NOT FOUND: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Rota não encontrada no servidor backend', path: req.url });
});

// Sync Omie → Supabase 4x por dia: 06h, 12h, 18h, 23h (horário do servidor)
cron.schedule('0 6,12,18,23 * * *', () => {
    logger.info('[cron] Iniciando sync automático Omie VP...');
    syncOmieProdutos().catch(err => logger.error(`[cron] Sync error: ${err.message}`));
});

// Sync histórico de compras (Escamax x VerticalParts) 1x por dia às 05h —
// mantém o retroativo de 01/01/2024 sempre completo e traz pedidos novos.
cron.schedule('0 5 * * *', () => {
    logger.info('[cron] Iniciando sync automático do histórico de compras...');
    sincronizarTodasFiliais().catch(err => logger.error(`[cron] Compras histórico sync error: ${err.message}`));
});

app.listen(PORT, () => {
    const banner = `
=========================================
  ESCAMAX PORTAL SERVER v1.0.5 - ONLINE
  Porta: ${PORT}
  Rotas Checkout Ativas: /api/checkout/*
=========================================`;
    logger.info(banner);
    console.log(banner);
});
