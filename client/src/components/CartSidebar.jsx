import React, { useState, useEffect } from 'react';
import { ShoppingCart, X, Plus, Minus, Trash2, CheckCircle, Loader2, Image as ImageIcon, Truck, Star, CreditCard, Tag, MapPin } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const TIPOS_FRETE = [
    { value: '0', label: 'CIF – Por conta da VerticalParts' },
    { value: '1', label: 'FOB – Por conta da Escamax' },
    { value: '2', label: 'Transportadora coleta na VerticalParts' },
];

const PRIORIDADES = [
    { value: 'Balcão', label: 'Balcão', sub: '30 min' },
    { value: 'Urgente', label: 'Urgente', sub: '3 horas' },
    { value: 'Normal', label: 'Normal', sub: '24 horas' },
];

// ── Componentes auxiliares ────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <Icon size={13} className="text-primary-dark" />
            <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-[0.14em]">{label}</span>
        </div>
    );
}

function RadioGroup({ options, value, onChange, columns = 1 }) {
    return (
        <div className={`grid gap-2 ${columns === 2 ? 'grid-cols-2' : columns === 3 ? 'grid-cols-3' : 'grid-cols-1'}`}>
            {options.map(opt => {
                const active = value === opt.value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        className={`rounded border px-3 py-2 text-left transition-colors text-xs font-semibold
                            ${active
                                ? 'bg-primary/15 border-primary text-black'
                                : 'bg-white border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-black'
                            }`}
                    >
                        <span className="block">{opt.label}</span>
                        {opt.sub && <span className={`text-[10px] font-medium ${active ? 'text-primary-dark' : 'text-neutral-400'}`}>{opt.sub}</span>}
                    </button>
                );
            })}
        </div>
    );
}

const inputCls = "w-full bg-white border border-neutral-200 rounded px-3 py-2 text-black text-xs outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 transition placeholder:text-neutral-400";
const labelCls = "text-[11px] font-bold text-neutral-500 uppercase tracking-[0.12em] block mb-1";

// ── Componente principal ──────────────────────────────────────────────────────

export default function CartSidebar({ isOpen, onClose, cart, updateQuantity, removeFromItem, clearCart, validacaoRef, finalidade, setFinalidade }) {
    const { filial } = useAuth();
    const [isCheckingOut, setIsCheckingOut] = useState(false);
    const [checkoutStatus, setCheckoutStatus] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [finalidadeLocal, setFinalidadeLocal] = useState('Revenda');
    const finalidadeAtual = finalidade || finalidadeLocal;
    const setFinalidadeAtual = setFinalidade || setFinalidadeLocal;

    const [tipoFrete, setTipoFrete] = useState('1'); // FOB padrão
    const [prioridade, setPrioridade] = useState('Normal');
    const [valorEntrada, setValorEntrada] = useState('');
    const [dataEntrada, setDataEntrada] = useState('');
    const [parcelas, setParcelas] = useState('0');

    // Campos condicionais de frete
    const [enderecoEntrega, setEnderecoEntrega] = useState('');
    const [transportadoraRazao, setTransportadoraRazao] = useState('');
    const [transportadoraCnpj, setTransportadoraCnpj] = useState('');
    const [preflight, setPreflight] = useState(null);
    const [idempotencyKey, setIdempotencyKey] = useState(() => `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    useEffect(() => {
        if (isOpen) {
            setCheckoutStatus(null);
            setErrorMessage('');
            setIsCheckingOut(false);
            setPreflight(null);
            setIdempotencyKey(`checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        }
    }, [isOpen]);

    const totalItems = cart.reduce((sum, item) => sum + (item.mmBased ? 1 : item.quantity), 0);
    const totalPrice = cart.reduce((sum, item) => sum + (item.preco * item.quantity), 0);
    const limiteRevenda70 = validacaoRef?.tipo === 'pedido-venda' ? Number(validacaoRef.limiteCompra70 || 0) : 0;
    const valorProposta = validacaoRef?.tipo === 'pedido-venda' ? Number(validacaoRef.valorTotal || 0) : 0;
    const limiteRevendaExcedido = validacaoRef?.tipo === 'pedido-venda' && limiteRevenda70 > 0 && totalPrice > limiteRevenda70;
    const valorEntradaNumber = parseFloat(valorEntrada) || 0;
    const parcelasNumber = Number.parseInt(parcelas, 10);
    const entradaMaiorQueTotal = valorEntradaNumber > totalPrice;
    const entradaSemData = valorEntradaNumber > 0 && !dataEntrada;

    const formatarMoeda = (valor) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

    const today = new Date().toISOString().slice(0, 10);

    const addDays = (date, days) => {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        return next;
    };

    const parcelamentoPreview = (() => {
        const total = Math.round((totalPrice + Number.EPSILON) * 100) / 100;
        if (!total || entradaMaiorQueTotal || entradaSemData) return [];
        const entrada = Math.round((valorEntradaNumber + Number.EPSILON) * 100) / 100;
        const restante = Math.round((total - entrada + Number.EPSILON) * 100) / 100;
        const result = [];
        let numero = 1;
        const baseDate = new Date();
        if (entrada > 0) {
            result.push({ numero: numero++, valor: entrada, data: dataEntrada ? new Date(`${dataEntrada}T12:00:00`) : null });
        }
        if (restante > 0) {
            const count = Math.max(1, Number.isNaN(parcelasNumber) || parcelasNumber === 0 ? 1 : parcelasNumber);
            const base = Math.floor((restante / count) * 100) / 100;
            let acumulado = 0;
            for (let index = 0; index < count; index += 1) {
                const valor = index === count - 1
                    ? Math.round((restante - acumulado + Number.EPSILON) * 100) / 100
                    : base;
                acumulado = Math.round((acumulado + valor + Number.EPSILON) * 100) / 100;
                result.push({ numero: numero++, valor, data: addDays(baseDate, 30 * (index + 1)) });
            }
        }
        return result;
    })();

    const formatarData = (date) => date ? date.toLocaleDateString('pt-BR') : '-';

    const montarCheckoutPayload = () => ({
        unidade: filial?.id,
        idempotencyKey,
        pedidoVendaRef: validacaoRef?.tipo === 'pedido-venda' ? validacaoRef.numero : null,
        contratoRef: validacaoRef?.tipo === 'contrato' ? validacaoRef.numero : null,
        itens: cart.map(item => ({
            codigo: item.codigo,
            quantidade: item.quantity,
            preco_unitario: item.preco,
            preco_original: item.preco_original,
        })),
        finalidade: finalidadeAtual,
        tipoFrete,
        prioridade,
        enderecoEntrega: tipoFrete === '0' ? enderecoEntrega : null,
        transportadora: tipoFrete === '2' ? {
            razaoSocial: transportadoraRazao,
            cnpj: transportadoraCnpj,
        } : null,
        pagamento: {
            valorEntrada: valorEntradaNumber,
            dataEntrada: dataEntrada || null,
            parcelas: Number.isNaN(parcelasNumber) ? 0 : parcelasNumber,
        }
    });

    const handleCheckout = async () => {
        if (limiteRevendaExcedido) {
            setCheckoutStatus('error');
            setErrorMessage('Compra bloqueada: O valor total do carrinho excede o limite de 70% permitido para esta Proposta.');
            return;
        }
        if (entradaMaiorQueTotal) {
            setCheckoutStatus('error');
            setErrorMessage('Compra bloqueada: o valor de entrada não pode ser maior que o total do pedido.');
            return;
        }
        if (entradaSemData) {
            setCheckoutStatus('error');
            setErrorMessage('Compra bloqueada: informe a data da entrada antes de finalizar.');
            return;
        }

        setIsCheckingOut(true);
        setCheckoutStatus(null);
        setErrorMessage('');
        try {
            const token = localStorage.getItem('token');
            const payload = montarCheckoutPayload();
            const preflightRes = await fetch('/api/checkout/preflight', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
            const preflightData = await preflightRes.json().catch(() => ({}));
            if (!preflightRes.ok || preflightData.ok === false) {
                const msg = preflightData.error || 'Pré-validação do pedido falhou.';
                setErrorMessage(msg);
                throw new Error(msg);
            }
            setPreflight(preflightData);

            const res = await fetch('/api/checkout/processar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errorData = await res.json();
                const msg = errorData.detail || errorData.error || 'Falha no checkout';
                setErrorMessage(msg);
                throw new Error(msg);
            }

            setCheckoutStatus('success');
            setTimeout(() => {
                clearCart();
                onClose();
                setCheckoutStatus(null);
                setIdempotencyKey(`checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`);
            }, 3000);
        } catch (err) {
            console.error(err);
            setCheckoutStatus('error');
            if (!errorMessage) setErrorMessage(err.message || 'Erro inesperado');
        } finally {
            setIsCheckingOut(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/50 z-[100]" onClick={onClose} />

            {/* Sidebar */}
            <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white border-l border-neutral-200 z-[101] shadow-xl flex flex-col animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className="p-5 border-b border-neutral-200 flex justify-between items-center bg-neutral-50 shrink-0">
                    <div className="flex items-center gap-3">
                        <ShoppingCart className="text-primary-dark" size={20} />
                        <h2 className="font-display text-xl text-black">Meu Carrinho</h2>
                        <span className="bg-primary text-black text-[10px] font-black px-2 py-0.5 rounded-full">
                            {totalItems}
                        </span>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-neutral-200 rounded transition-colors text-neutral-400">
                        <X size={22} />
                    </button>
                </div>

                {/* Filial requisitante (vem do contexto) */}
                <div className="px-5 py-3 bg-neutral-50 border-b border-neutral-200 shrink-0 space-y-2">
                    <div>
                        <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-[0.12em] mb-1.5">
                            Unidade Requisitante
                        </p>
                        <div className="flex items-center gap-2 rounded border border-neutral-200 bg-white px-3 py-2">
                            <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="text-sm font-bold text-black">
                                {filial ? `Escamax ${filial.label}` : '—'}
                            </span>
                        </div>
                    </div>
                    {validacaoRef?.validado && (
                        <div>
                            <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-[0.12em] mb-1.5">
                                {validacaoRef.tipo === 'contrato' ? 'Contrato Vinculado' : 'Pedido de Venda Vinculado'}
                            </p>
                            <div className="flex items-center gap-2 rounded border border-green-200 bg-green-50 px-3 py-2">
                                <Tag className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                <div className="min-w-0">
                                    <span className="text-sm font-bold text-green-800 font-mono">
                                        Nº {validacaoRef.numero}
                                    </span>
                                    {validacaoRef.tipo === 'pedido-venda' && valorProposta > 0 && (
                                        <p className="text-[11px] font-semibold text-green-700">
                                            Limite 70%: {formatarMoeda(limiteRevenda70)}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Scroll area: itens + detalhes do pedido */}
                <div className="flex-1 overflow-y-auto">

                    {/* Itens */}
                    <div className="p-5 space-y-3">
                        {cart.length === 0 ? (
                            <div className="py-16 flex flex-col items-center justify-center text-neutral-400 gap-4">
                                <ShoppingCart size={48} className="opacity-20" />
                                <p className="text-sm font-medium">Seu carrinho está vazio.</p>
                            </div>
                        ) : (
                            cart.map((item) => (
                                <div key={item.codigo} className="rounded-xl border border-neutral-200 bg-white shadow-card p-4 flex gap-3 group">
                                    <div className="w-14 h-14 rounded bg-neutral-50 border border-neutral-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                        {item.url_imagem ? (
                                            <img src={item.url_imagem} alt={item.descricao} className="w-full h-full object-contain" />
                                        ) : (
                                            <ImageIcon size={18} className="text-neutral-300" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start gap-2">
                                            <h4 className="text-xs font-bold text-black leading-tight" title={item.descricao}>{item.descricao}</h4>
                                            <button onClick={() => removeFromItem(item.codigo)} className="text-neutral-400 hover:text-danger transition-colors shrink-0">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                        <p className="text-[10px] font-mono text-neutral-400 mb-1.5">{item.codigo}</p>
                                        <div className="flex justify-between items-center">
                                            <span className="text-green-600 font-bold text-sm">
                                                {item.mmBased ? `${formatarMoeda(item.preco)}/mm` : formatarMoeda(item.preco)}
                                            </span>
                                            {item.mmBased ? (
                                                <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                                                    {item.quantity} mm
                                                </span>
                                            ) : (
                                                <div className="flex items-center bg-white rounded border border-neutral-200">
                                                    <button onClick={() => updateQuantity(item.codigo, -1)} className="p-1 text-neutral-500 hover:text-primary-dark transition-colors"><Minus size={12} /></button>
                                                    <span className="w-7 text-center text-xs font-bold text-black">{item.quantity}</span>
                                                    <button onClick={() => updateQuantity(item.codigo, 1)} className="p-1 text-neutral-500 hover:text-primary-dark transition-colors"><Plus size={12} /></button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* ── Detalhes do Pedido ─────────────────────────────────────── */}
                    {cart.length > 0 && (
                        <div className="px-5 pb-5 space-y-5 border-t border-neutral-200 pt-4">

                            {/* Finalidade */}
                            <div>
                                <SectionHeader icon={Tag} label="Finalidade do Material" />
                                <RadioGroup
                                    options={[
                                        { value: 'Revenda', label: 'Revenda' },
                                        { value: 'Atendimento a Contrato', label: 'Atendimento a Contrato' },
                                    ]}
                                    value={finalidadeAtual}
                                    onChange={setFinalidadeAtual}
                                    columns={2}
                                />
                            </div>

                            {/* Prioridade */}
                            <div>
                                <SectionHeader icon={Star} label="Prioridade" />
                                <RadioGroup
                                    options={PRIORIDADES}
                                    value={prioridade}
                                    onChange={setPrioridade}
                                    columns={3}
                                />
                            </div>

                            {/* Tipo de Frete */}
                            <div>
                                <SectionHeader icon={Truck} label="Tipo de Frete" />
                                <div className="grid grid-cols-1 gap-1.5">
                                    {TIPOS_FRETE.map(opt => {
                                        const active = tipoFrete === opt.value;
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setTipoFrete(opt.value)}
                                                className={`rounded border px-3 py-2 text-left text-xs font-semibold transition-colors flex items-center gap-2
                                                    ${active
                                                        ? 'bg-primary/15 border-primary text-black'
                                                        : 'bg-white border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-black'
                                                    }`}
                                            >
                                                <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${active ? 'border-primary' : 'border-neutral-300'}`}>
                                                    {active && <span className="w-2 h-2 rounded-full bg-primary" />}
                                                </span>
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Campo condicional: Endereço de Entrega (CIF) */}
                                {tipoFrete === '0' && (
                                    <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                        <label className={labelCls}>Endereço de Entrega</label>
                                        <textarea
                                            value={enderecoEntrega}
                                            onChange={e => setEnderecoEntrega(e.target.value)}
                                            placeholder="Rua, número, bairro, cidade, estado, CEP..."
                                            rows={2}
                                            className={`${inputCls} resize-none`}
                                        />
                                    </div>
                                )}

                                {/* Campos condicionais: Dados da Transportadora */}
                                {tipoFrete === '2' && (
                                    <div className="mt-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                        <div>
                                            <label className={labelCls}>Razão Social da Transportadora</label>
                                            <input
                                                type="text"
                                                value={transportadoraRazao}
                                                onChange={e => setTransportadoraRazao(e.target.value)}
                                                placeholder="Ex: Transportes ABC Ltda"
                                                className={inputCls}
                                            />
                                        </div>
                                        <div>
                                            <label className={labelCls}>CNPJ da Transportadora</label>
                                            <input
                                                type="text"
                                                value={transportadoraCnpj}
                                                onChange={e => setTransportadoraCnpj(e.target.value)}
                                                placeholder="00.000.000/0000-00"
                                                className={inputCls}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Forma de Pagamento */}
                            <div>
                                <SectionHeader icon={CreditCard} label="Forma de Pagamento" />
                                <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className={labelCls}>Valor da Entrada (R$)</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                placeholder="0,00"
                                                value={valorEntrada}
                                                onChange={e => setValorEntrada(e.target.value)}
                                                className={inputCls}
                                            />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Data da Entrada</label>
                                            <input
                                                type="date"
                                                min={today}
                                                value={dataEntrada}
                                                onChange={e => setDataEntrada(e.target.value)}
                                                className={inputCls}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className={labelCls}>Restante em quantas parcelas</label>
                                        <select
                                            value={parcelas}
                                            onChange={e => setParcelas(e.target.value)}
                                            className={inputCls}
                                        >
                                            <option value="0">À vista (sem parcelamento)</option>
                                            {[...Array(12)].map((_, i) => (
                                                <option key={i + 1} value={i + 1}>{i + 1}x</option>
                                            ))}
                                        </select>
                                    </div>
                                    {parcelamentoPreview.length > 0 && (
                                        <div className="rounded border border-blue-100 bg-blue-50 p-3">
                                            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-blue-700">Prévia do parcelamento Omie</p>
                                            <div className="grid gap-1">
                                                {parcelamentoPreview.map(parcela => (
                                                    <div key={parcela.numero} className="flex justify-between rounded bg-white px-2 py-1 text-[11px] font-semibold text-blue-900">
                                                        <span>{parcela.numero}/{parcelamentoPreview.length}</span>
                                                        <span>{formatarMoeda(parcela.valor)}</span>
                                                        <span>{formatarData(parcela.data)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer / Checkout */}
                {cart.length > 0 && (
                    <div className="p-5 bg-neutral-50 border-t border-neutral-200 space-y-3 shrink-0">
                        <div className="flex justify-between items-center">
                            <span className="text-neutral-500 text-[11px] font-bold uppercase tracking-[0.12em]">Total do Pedido</span>
                            <span className="text-xl font-bold text-black">{formatarMoeda(totalPrice)}</span>
                        </div>

                        {limiteRevendaExcedido && (
                            <div className="rounded border border-red-200 bg-red-50 p-3 text-xs font-semibold text-danger">
                                ❌ Compra bloqueada: O valor total do carrinho excede o limite de 70% permitido para esta Proposta.
                                <div className="mt-1 text-[11px] font-medium text-red-700">
                                    Total do carrinho: {formatarMoeda(totalPrice)} · Limite: {formatarMoeda(limiteRevenda70)}
                                </div>
                            </div>
                        )}
                        {(entradaMaiorQueTotal || entradaSemData) && (
                            <div className="rounded border border-red-200 bg-red-50 p-3 text-xs font-semibold text-danger">
                                {entradaMaiorQueTotal
                                    ? 'Compra bloqueada: o valor de entrada não pode ser maior que o total do pedido.'
                                    : 'Compra bloqueada: informe a data da entrada antes de finalizar.'}
                            </div>
                        )}

                        {checkoutStatus === 'success' ? (
                            <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded flex items-center gap-3">
                                <CheckCircle size={20} />
                                <span className="text-sm font-bold">
                                    Pedido enviado para aprovação{preflight?.planoPagamento?.qtdeParcelas ? ` · ${preflight.planoPagamento.qtdeParcelas} parcela(s) validadas` : ''}!
                                </span>
                            </div>
                        ) : checkoutStatus === 'error' ? (
                            <div className="bg-red-50 border border-red-200 text-danger p-4 rounded flex items-center gap-3">
                                <X size={20} className="flex-shrink-0" />
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold">Erro no Pedido</span>
                                    <span className="text-[11px] leading-tight opacity-90">{errorMessage}</span>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={handleCheckout}
                                disabled={
                                    isCheckingOut ||
                                    !filial ||
                                    limiteRevendaExcedido ||
                                    entradaMaiorQueTotal ||
                                    entradaSemData ||
                                    (tipoFrete === '0' && !enderecoEntrega.trim()) ||
                                    (tipoFrete === '2' && (!transportadoraRazao.trim() || !transportadoraCnpj.trim()))
                                }
                                className="w-full bg-primary hover:bg-primary-light hover:shadow-brand-sm disabled:bg-neutral-200 disabled:text-neutral-400 text-black font-bold py-3.5 rounded transition-all flex items-center justify-center gap-3 active:scale-95 disabled:cursor-not-allowed"
                            >
                                {isCheckingOut ? (
                                    <>
                                        <Loader2 className="animate-spin" size={20} />
                                        Pré-validando e sincronizando B2B...
                                    </>
                                ) : (
                                    'FINALIZAR PEDIDO NO OMIE'
                                )}
                            </button>
                        )}
                        <p className="text-[10px] text-center text-neutral-400">
                            Ao finalizar, um Pedido de Compra será criado em <strong>Escamax {filial?.label}</strong> e um Pedido de Venda na <strong>VerticalParts</strong>.
                        </p>
                    </div>
                )}
            </div>
        </>
    );
}
