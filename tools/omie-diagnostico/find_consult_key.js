async function findConsultKey() {
    const keys = ['nCodPed', 'codigo_pedido_omie', 'codigo_pedido', 'nNumeroPedido', 'cCodIntPed'];
    const values = {
        'nCodPed': 23,
        'codigo_pedido_omie': 23,
        'codigo_pedido': 23,
        'nNumeroPedido': "23",
        'cCodIntPed': "" // não temos o ID de integração do 23
    };

    for (const k of keys) {
        try {
            const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    call: 'ConsultarPedCompra',
                    app_key: '7040637959355',
                    app_secret: 'cfd2ea2a8ecb7eba5637f8acfa2d1eb8',
                    param: [{ [k]: values[k] }]
                })
            });
            const data = await response.json();
            console.log(`Key: ${k} | Status: ${data.status || 'unknown'} | Fault: ${data.faultstring || 'None'}`);
            if (data.status === 'success' || (data.status === 'error' && data.faultstring && !data.faultstring.includes('não faz parte'))) {
                console.log('>>> WORKING KEY FOUND:', k);
                console.log(JSON.stringify(data, null, 2));
            }
        } catch (e) {
            // ignore
        }
    }
}

findConsultKey();
