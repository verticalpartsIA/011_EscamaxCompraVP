const express = require('express');
const multer = require('multer');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const ctrl = require('../controllers/servicosController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.use(authMiddleware);

router.get('/perfil', ctrl.meuPerfil);
router.get('/branches', ctrl.listarBranches);

router.get('/lpu', ctrl.listarLpu);
router.post('/lpu', adminMiddleware, ctrl.criarLpu);
router.patch('/lpu/:id', adminMiddleware, ctrl.atualizarLpu);

router.get('/', ctrl.listar);
router.post('/', ctrl.criar);
router.get('/:id', ctrl.obter);
router.patch('/:id', ctrl.atualizar);

router.post('/:id/itens', ctrl.adicionarItem);
router.delete('/:id/itens/:itemId', ctrl.removerItem);

router.post('/:id/comentarios', ctrl.comentar);

router.post('/:id/anexos', upload.single('arquivo'), ctrl.uploadAnexo);
router.get('/:id/anexos/:attachmentId/url', ctrl.baixarAnexo);

// Transições do fluxo de aprovação (gate do CEO → diretor comercial → financeiro)
router.post('/:id/enviar', ctrl.enviar);
router.post('/:id/decisao-ceo', ctrl.decidirCeo);
router.post('/:id/decisao-diretor', ctrl.decidirDiretor);
router.post('/:id/iniciar-analise-financeira', ctrl.iniciarAnaliseFinanceira);
router.post('/:id/decisao-financeiro', ctrl.decidirFinanceiro);
router.post('/:id/reenviar-financeiro', ctrl.reenviarFinanceiro);
router.post('/:id/cancelar', ctrl.cancelar);

module.exports = router;
