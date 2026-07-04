async function consultOrder() {
    try {
        const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                call: 'ConsultarPedCompra',
                app_key: '7040637959355',
                app_secret: 'cfd2ea2a8ecb7eba5637f8acfa2d1eb8',
                param: [{
                    nNumeroPedido: "23"
                }]
            })
        });
        const data = await response.json();
        console.log('--- ConsultarPedCompra Response ---');
        console.log(JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
    }
}

consultOrder();
