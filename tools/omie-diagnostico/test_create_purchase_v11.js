async function createTestOrder() {
    try {
        const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                call: 'IncluirPedCompra',
                app_key: '7040637959355',
                app_secret: 'cfd2ea2a8ecb7eba5637f8acfa2d1eb8',
                param: [{
                    pedido_compra_infra: {
                        cabecalho: {
                            cCodIntPed: `TEST-${Date.now()}`,
                            nCodFor: 603951909,
                            dDtPrevisao: new Date().toLocaleDateString('pt-BR'),
                            cCodCateg: '2.01.01',
                            nCodCC: 0
                        },
                        itens_pedido: [
                            {
                                item_pedido: {
                                    nCodProd: 603951911,
                                    nQtde: 1,
                                    nValUnit: 10.00
                                }
                            }
                        ]
                    }
                }]
            })
        });
        const data = await response.json();
        console.log('--- Test IncluirPedCompra Response (pedido_compra_infra wrapped) ---');
        console.log(JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
    }
}

createTestOrder();
