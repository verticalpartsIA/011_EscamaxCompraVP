const tags = [
    'detalhes',
    'itens_det_pedido_compra',
    'lista_itens_pedido',
    'itens_pedido_incluir_lista',
    'itens_pedido_lista'
];

async function testBatch() {
    for (const t of tags) {
        try {
            const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    call: 'IncluirPedCompra',
                    app_key: '7040637959355',
                    app_secret: 'cfd2ea2a8ecb7eba5637f8acfa2d1eb8',
                    param: [{
                        cabecalho_incluir: {
                            cCodIntPed: `BATCH-${t}-${Date.now()}`,
                            nCodFor: 603951909,
                            dDtPrevisao: new Date().toLocaleDateString('pt-BR'),
                            cCodCateg: '2.01.01',
                            nCodCC: 0
                        },
                        [t]: [{ nCodProd: 603951911, nQtde: 1, nValUnit: 10.00 }]
                    }]
                })
            });
            const data = await response.json();
            console.log(`Tag: ${t} | Status: ${data.status || 'unknown'} | Fault: ${data.faultstring || 'None'}`);
            if (data.status === 'success' || (data.status === 'error' && data.faultstring && !data.faultstring.includes('não faz parte'))) {
                console.log('>>> POTENTIAL MATCH FOR:', t);
            }
        } catch (e) {
            // ignore
        }
    }
}

testBatch();
