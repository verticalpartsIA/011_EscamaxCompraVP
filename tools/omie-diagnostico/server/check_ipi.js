// Isolado: ConsultarPedido para ver estrutura de total_pedido
require('dotenv').config({ path: './.env' });
const https = require('https');
const KEY = process.env.OMIE_APP_KEY;
const SEC = process.env.OMIE_APP_SECRET;

function post(call, param, cb) {
    const b = JSON.stringify({ call, app_key: KEY, app_secret: SEC, param: [param] });
    const req = https.request({
        hostname: 'app.omie.com.br', path: '/api/v1/produtos/pedido/',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => cb(JSON.parse(d))); });
    req.write(b); req.end();
}

post('ConsultarPedido', { numero_pedido: '27769' }, r => {
    console.log('TOP KEYS:', Object.keys(r).join(', '));

    // Qual estrutura tem total_pedido?
    const top = r.total_pedido;
    const nest = r.pedido_venda_produto?.total_pedido;
    const target = top || nest;

    console.log('\nTotal do pedido encontrado em:',
        top ? 'r.total_pedido' : nest ? 'r.pedido_venda_produto.total_pedido' : 'NENHUM');

    if (target) {
        console.log('\nCampos total_pedido:');
        Object.entries(target).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    }
});
