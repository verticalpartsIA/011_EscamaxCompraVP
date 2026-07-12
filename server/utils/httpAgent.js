const https = require('https');

// Agente HTTPS com keep-alive compartilhado por todo o backend. Sem isso,
// cada chamada (node-fetch para o Supabase, axios para a Omie) negocia TLS
// do zero — medido em ~50% do tempo total de cada requisição. Reaproveitar
// a conexão entre chamadas ao mesmo host corta esse custo na maioria das
// vezes (a conexão fica viva por até 60s depois do último uso).
const keepAliveAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 60000,
    maxSockets: 50,
});

module.exports = { keepAliveAgent };
