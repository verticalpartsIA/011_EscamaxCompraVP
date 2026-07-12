const nodeFetch = require('node-fetch');
const { keepAliveAgent } = require('./httpAgent');

// Substituto direto de node-fetch (mesma assinatura) que reaproveita conexão
// HTTPS por padrão. Import drop-in: troca `require('node-fetch')` por este
// módulo, nenhuma chamada individual precisa mudar.
function fetchComKeepAlive(url, options = {}) {
    return nodeFetch(url, { agent: keepAliveAgent, ...options });
}

module.exports = fetchComKeepAlive;
