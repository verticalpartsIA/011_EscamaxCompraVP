import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, Loader2, Package, AlertCircle, RefreshCw, LayoutGrid, List, Image as ImageIcon, ShoppingCart, Plus, Minus, Check, Ruler, AlertTriangle, X, Zap, RotateCw } from 'lucide-react';
import CartSidebar from '../components/CartSidebar';
import { useProductCache } from '../hooks/useProductCache';

const CATEGORIAS = ['Todos', 'Corrimãos', 'Escada/Esteira', 'Elevadores', 'BST/Monarch', 'Outros'];

// ── Helpers ──────────────────────────────────────────────────────────────────
const getCategoryStyles = (codigo) => {
    const code = (codigo || '').toUpperCase();
    if (code.startsWith('VPB-')) return 'bg-purple-100 text-purple-700 border-purple-200';
    if (code.startsWith('VPEL-')) return 'bg-orange-100 text-orange-700 border-orange-200';
    if (code.startsWith('VPER-')) return 'bg-blue-100 text-blue-700 border-blue-200';
    // Corrimãos (VP-, VPP-, VPKIT-, VPPKIT-, VPPU-)
    if (code.startsWith('VPPKIT-') || code.startsWith('VPKIT-') || code.startsWith('VPPU-') ||
        code.startsWith('VPP-') || code.startsWith('VP-'))
        return 'bg-teal-100 text-teal-700 border-teal-200';
    return 'bg-neutral-100 text-neutral-600 border-neutral-200';
};

const getCategoryBadgeStyles = (cat, active) => {
    if (active) return 'bg-primary text-black border-primary';
    return 'bg-white text-neutral-600 border-neutral-200 hover:border-primary hover:text-black';
};

const formatarMoeda = (valor) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

/** Detecta corrimãos vendidos por metro/mm */
const isCorrimao = (part) => {
    const code = (part?.codigo || '').toUpperCase();
    return (
        code.startsWith('VP-') ||
        code.startsWith('VPP-') ||
        code.startsWith('VPPU-')
    );
};

// ── Controle de quantidade para produtos NORMAIS ──────────────────────────────
function QtyControl({ value, onDec, onInc, size = 'sm' }) {
    const btn = size === 'sm' ? 'p-1' : 'p-2';
    const iconSz = size === 'sm' ? 12 : 16;
    const spanW = size === 'sm' ? 'w-6' : 'w-10';
    return (
        <div className="flex items-center bg-white rounded border border-neutral-200">
            <button onClick={onDec} className={`${btn} text-neutral-500 hover:text-primary-dark transition-colors`}><Minus size={iconSz} /></button>
            <span className={`${spanW} text-center text-xs font-bold text-black`}>{value}</span>
            <button onClick={onInc} className={`${btn} text-neutral-500 hover:text-primary-dark transition-colors`}><Plus size={iconSz} /></button>
        </div>
    );
}

// ── Campo de medida em mm para CORRIMÃO ──────────────────────────────────────
function MmInput({ value, onChange, preco, compact = false }) {
    const precoPorMm = preco / 1000;
    const totalPrev = precoPorMm * (value || 0);
    return (
        <div className={`flex flex-col gap-1 ${compact ? '' : 'w-full'}`}>
            <div className="flex items-center gap-1">
                <Ruler size={12} className="text-amber-500 shrink-0" />
                <input
                    type="number"
                    min={1}
                    value={value || ''}
                    onChange={e => onChange(Math.max(1, parseInt(e.target.value) || 1))}
                    placeholder="mm"
                    className={`bg-white border border-amber-300 rounded text-black text-xs font-bold text-center outline-none focus:border-amber-500 focus:ring-[3px] focus:ring-amber-500/20 transition ${compact ? 'w-20 py-1 px-1' : 'w-full py-1.5 px-2'}`}
                />
            </div>
            {!compact && value > 0 && (
                <p className="text-[10px] font-bold text-amber-600 text-right">≈ {formatarMoeda(totalPrev)}</p>
            )}
        </div>
    );
}

export default function SearchPage() {
    // ── Product data via IndexedDB cache ──────────────────────────────────────
    const { parts: allParts, loading, syncStatus, syncProgress, error, refresh, lastUpdate } = useProductCache();

    const [query, setQuery] = useState('');
    const [categoriaAtiva, setCat] = useState('Todos');
    const [viewMode, setViewMode] = useState('list');
    const [selectedPart, setSelectedPart] = useState(null);

    // Carrinho
    const [cart, setCart] = useState(() => {
        try { return JSON.parse(localStorage.getItem('escamax_cart') || '[]'); } catch { return []; }
    });
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [quantities, setQuantities] = useState({});   // { codigo: qty (unidades) }
    const [mmValues, setMmValues] = useState({});        // { codigo: mm (corrimão) }
    const [addedFeedback, setAddedFeedback] = useState({});
    const [zeroStockPopup, setZeroStockPopup] = useState(null); // { product, qty }

    // Persistência local do carrinho
    React.useEffect(() => {
        localStorage.setItem('escamax_cart', JSON.stringify(cart));
    }, [cart]);

    const addToCart = (product) => {
        const corrimao = isCorrimao(product);
        const qty = corrimao ? (mmValues[product.codigo] || 1) : (quantities[product.codigo] || 1);

        // Bloqueia produtos sem estoque e registra demanda
        if (!product.estoque || product.estoque <= 0) {
            const demands = JSON.parse(localStorage.getItem('escamax_demandas') || '[]');
            const idx = demands.findIndex(d => d.codigo === product.codigo);
            if (idx >= 0) {
                demands[idx].quantidade = Math.max(demands[idx].quantidade, qty);
                demands[idx].data = new Date().toISOString();
            } else {
                demands.push({
                    codigo: product.codigo,
                    descricao: product.descricao,
                    quantidade: qty,
                    data: new Date().toISOString(),
                });
            }
            localStorage.setItem('escamax_demandas', JSON.stringify(demands));
            window.dispatchEvent(new Event('storage')); // notifica Sidebar
            setZeroStockPopup({ product, qty });
            return;
        }

        let cartItem;
        if (corrimao) {
            const mm = mmValues[product.codigo] || 1;
            const precoPorMm = product.preco / 1000;
            cartItem = { ...product, quantity: mm, preco: precoPorMm, mmBased: true };
        } else {
            cartItem = { ...product, quantity: qty };
        }

        setCart(prev => {
            const existing = prev.find(i => i.codigo === product.codigo);
            if (existing) {
                return prev.map(i =>
                    i.codigo === product.codigo
                        ? { ...i, quantity: corrimao ? cartItem.quantity : i.quantity + cartItem.quantity }
                        : i
                );
            }
            return [...prev, cartItem];
        });

        setAddedFeedback(prev => ({ ...prev, [product.codigo]: true }));
        setTimeout(() => setAddedFeedback(prev => ({ ...prev, [product.codigo]: false })), 2000);
    };

    const updateCartQuantity = (codigo, delta) => {
        setCart(prev => prev.map(item => {
            if (item.codigo !== codigo) return item;
            if (item.mmBased) return item; // mm não usa stepper
            return { ...item, quantity: Math.max(1, item.quantity + delta) };
        }));
    };

    const removeFromCart = (codigo) => setCart(prev => prev.filter(i => i.codigo !== codigo));

    const updateQty = (codigo, delta) =>
        setQuantities(prev => ({ ...prev, [codigo]: Math.max(1, (prev[codigo] || 1) + delta) }));

    const setMm = (codigo, v) => setMmValues(prev => ({ ...prev, [codigo]: v }));

    const resultados = useMemo(() => {
        const q = query.toLowerCase().trim();
        const filtered = allParts.filter(p => {
            const matchQuery = !q ||
                (p.codigo || '').toLowerCase().includes(q) ||
                (p.descricao || '').toLowerCase().includes(q);
            const matchCat = categoriaAtiva === 'Todos' || p.categoria === categoriaAtiva;
            return matchQuery && matchCat;
        });
        return filtered.sort((a, b) =>
            (a.codigo || '').localeCompare(b.codigo || '', undefined, { numeric: true, sensitivity: 'base' })
        );
    }, [allParts, query, categoriaAtiva]);

    // Para o badge do carrinho: contar itens mm como 1
    const totalCartItems = cart.reduce((s, i) => s + (i.mmBased ? 1 : i.quantity), 0);

    // CartSidebar via portal: evita qualquer problema de overflow/stacking do ancestral
    const cartPortal = createPortal(
        <CartSidebar
            isOpen={isCartOpen}
            onClose={() => setIsCartOpen(false)}
            cart={cart}
            updateQuantity={updateCartQuantity}
            removeFromItem={removeFromCart}
            clearCart={() => setCart([])}
        />,
        document.body
    );

    const zeroStockModal = zeroStockPopup && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            {/* Overlay */}
            <div className="absolute inset-0 bg-black/50" onClick={() => setZeroStockPopup(null)} />
            {/* Modal */}
            <div className="relative bg-white border border-amber-300 rounded-xl shadow-xl p-6 max-w-sm w-full animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-amber-100 border border-amber-200 flex-shrink-0">
                        <AlertTriangle size={24} className="text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-display text-lg text-black">Produto sem estoque</h3>
                        <p className="text-neutral-600 text-sm mt-1 leading-snug">
                            <span className="font-mono text-amber-700 font-bold">{zeroStockPopup.product.codigo}</span>
                            {' — '}{(zeroStockPopup.product.descricao || '').slice(0, 60)}
                        </p>
                        <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded">
                            <p className="text-xs font-bold text-amber-700">
                                ✅ Demanda de {zeroStockPopup.qty} {zeroStockPopup.product.mmBased ? 'mm' : 'un'} registrada
                            </p>
                            <p className="text-[11px] text-neutral-500 mt-0.5">Acompanhe no menu lateral, acima de Dashboard.</p>
                        </div>
                    </div>
                    <button onClick={() => setZeroStockPopup(null)} className="text-neutral-400 hover:text-black transition-colors flex-shrink-0">
                        <X size={18} />
                    </button>
                </div>
                <button
                    onClick={() => setZeroStockPopup(null)}
                    className="mt-4 w-full py-2.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-sm font-bold transition-colors"
                >
                    Entendido
                </button>
            </div>
        </div>,
        document.body
    );

    return (
        <div className="max-w-7xl mx-auto space-y-5">
            {/* Cabeçalho */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="font-display text-2xl text-black">Estoque VerticalParts</h2>
                    <p className="text-sm text-neutral-500 mt-0.5">
                        {loading
                            ? 'Carregando produtos...'
                            : error
                                ? 'Erro ao carregar'
                                : `${resultados.length} produtos disponíveis`}
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Botão Carrinho */}
                    <button
                        onClick={() => setIsCartOpen(true)}
                        className="relative p-2.5 bg-primary text-black rounded hover:bg-primary-light hover:shadow-brand-sm transition-all active:scale-95"
                    >
                        <ShoppingCart size={20} />
                        {totalCartItems > 0 && (
                            <span className="absolute -top-2 -right-2 bg-black text-primary text-[10px] font-black px-2 py-0.5 rounded-full border-2 border-white">
                                {totalCartItems}
                            </span>
                        )}
                    </button>

                    <div className="flex bg-white rounded p-1 border border-neutral-200 mx-1">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-primary/15 text-primary-dark' : 'text-neutral-400 hover:text-neutral-700'}`}
                            title="Ver em grade"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-primary/15 text-primary-dark' : 'text-neutral-400 hover:text-neutral-700'}`}
                            title="Ver em lista"
                        >
                            <List size={18} />
                        </button>
                    </div>
                    <button
                        onClick={refresh}
                        disabled={syncStatus === 'syncing'}
                        className="flex items-center gap-2 px-3 py-2 rounded bg-white hover:bg-neutral-50 text-neutral-700 text-sm font-semibold border border-neutral-200 transition-colors disabled:opacity-50 flex-shrink-0"
                        title="Limpar cache e buscar dados frescos do Omie"
                    >
                        <RefreshCw size={14} className={syncStatus === 'syncing' ? 'animate-spin' : ''} />
                        Atualizar
                    </button>
                </div>
                {lastUpdate && (
                    <p className="text-[11px] text-neutral-400 text-right mt-1">
                        Última atualização: {lastUpdate.toLocaleDateString('pt-BR')} às {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                )}
            </div>

            {/* ── Banners de status do cache ───────────────────────────────── */}
            {syncStatus === 'cache' && (
                <div className="flex items-center gap-2 px-4 py-2 rounded bg-green-50 border border-green-200 text-green-700 text-xs font-semibold animate-in fade-in duration-300">
                    <Zap size={13} className="shrink-0" />
                    Carregado do cache local — clique em <strong className="mx-1">Atualizar</strong> para sincronizar com o Omie
                </div>
            )}
            {syncStatus === 'syncing' && (
                <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-primary-dark text-xs font-semibold">
                        <RotateCw size={13} className="animate-spin shrink-0" />
                        {syncProgress.total > 0
                            ? `Sincronizando produtos: ${syncProgress.loaded} / ${syncProgress.total}…`
                            : 'Sincronizando produtos com o Omie…'}
                    </div>
                    {syncProgress.total > 0 && (
                        <div className="w-full h-1 bg-neutral-200 rounded overflow-hidden">
                            <div
                                className="h-full bg-primary rounded transition-all duration-300"
                                style={{ width: `${Math.round((syncProgress.loaded / syncProgress.total) * 100)}%` }}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Barra de busca */}
            <div className="relative group max-w-4xl mx-auto w-full">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Search className="text-neutral-400 group-focus-within:text-primary-dark transition-colors" size={20} />
                </div>
                <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    className="w-full rounded-xl border border-neutral-200 bg-white pl-12 pr-6 py-3.5 text-sm text-black placeholder-neutral-400 shadow-card outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 transition"
                    placeholder="Filtrar por código ou descrição..."
                    disabled={loading || !!error}
                />
            </div>

            {/* Filtros de categoria */}
            {!loading && !error && (
                <div className="flex flex-wrap gap-2">
                    {CATEGORIAS.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setCat(cat)}
                            className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-[0.08em] border transition-colors ${getCategoryBadgeStyles(cat, categoriaAtiva === cat)}`}
                        >
                            {cat}
                            {cat !== 'Todos' && (
                                <span className="ml-1.5 opacity-60">
                                    {allParts.filter(p => p.categoria === cat).length}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* Conteúdo */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4 text-neutral-500">
                    <Loader2 size={40} className="animate-spin text-primary" />
                    <p className="text-sm font-medium">Consultando estoque na VerticalParts...</p>
                </div>
            ) : error ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                    <AlertCircle size={40} className="text-danger" />
                    <p className="text-danger text-sm font-semibold">{error}</p>
                    <button onClick={refresh} className="px-6 py-2.5 rounded bg-primary text-black text-sm font-bold hover:bg-primary-light transition-colors">Tentar novamente</button>
                </div>
            ) : resultados.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 gap-3 text-neutral-400">
                    <Package size={40} />
                    <p className="text-sm font-medium">Nenhum produto encontrado.</p>
                </div>
            ) : viewMode === 'grid' ? (
                /* ── GRID VIEW ── */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {resultados.map(part => {
                        const corrimao = isCorrimao(part);
                        const mm = mmValues[part.codigo] || '';
                        return (
                            <div
                                key={part.codigo}
                                onClick={(e) => { if (e.target.closest('button, input')) return; setSelectedPart(part); }}
                                className="rounded-xl border border-neutral-200 bg-white shadow-card hover:border-primary/60 transition-colors group relative flex flex-col overflow-hidden cursor-pointer"
                            >
                                <div className="mb-4 h-40 bg-neutral-50 flex items-center justify-center overflow-hidden border-b border-neutral-200">
                                    {part.url_imagem ? (
                                        <img src={part.url_imagem} alt={part.descricao} loading="lazy" className="w-full h-full object-contain hover:scale-110 transition-transform duration-500" />
                                    ) : (
                                        <ImageIcon size={40} className="text-neutral-300" />
                                    )}
                                </div>

                                <div className="relative z-10 flex-1 flex flex-col px-5 pb-5">
                                    <div className="flex justify-between items-start mb-3 gap-2">
                                        <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-1 rounded border ${getCategoryStyles(part.codigo)}`}>
                                            {part.categoria}
                                        </span>
                                        <span className={`text-[10px] font-bold px-2 py-1 rounded border ${part.estoque > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                            {corrimao ? `${part.estoque || 0} mm` : `Estq: ${part.estoque || 0}`}
                                        </span>
                                    </div>
                                    <div className="mb-4">
                                        <span className="text-[11px] font-mono text-neutral-400 block mb-1">{part.codigo}</span>
                                        <h3 className="text-sm font-bold text-black leading-tight min-h-[2.5rem] line-clamp-2" title={part.descricao}>
                                            {part.descricao}
                                        </h3>
                                    </div>
                                    <div className="mt-auto pt-4 border-t border-neutral-200 space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <span className="text-lg font-bold text-green-600">{formatarMoeda(part.preco)}</span>
                                                {corrimao && <span className="text-[10px] text-neutral-400 block">/metro</span>}
                                            </div>
                                            {corrimao ? (
                                                <MmInput value={mm} onChange={v => setMm(part.codigo, v)} preco={part.preco} compact />
                                            ) : (
                                                <QtyControl
                                                    value={quantities[part.codigo] || 1}
                                                    onDec={() => updateQty(part.codigo, -1)}
                                                    onInc={() => updateQty(part.codigo, 1)}
                                                />
                                            )}
                                        </div>
                                        <button
                                            onClick={() => addToCart(part)}
                                            disabled={corrimao && !mmValues[part.codigo]}
                                            className={`w-full py-2.5 rounded flex items-center justify-center gap-2 text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
                                                ${addedFeedback[part.codigo] ? 'bg-green-600 text-white' : 'bg-primary text-black hover:bg-primary-light'}`}
                                        >
                                            {addedFeedback[part.codigo] ? <><Check size={16} /> Adicionado</> : <><Plus size={16} /> {corrimao ? 'Adicionar medida' : 'Comprar'}</>}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                /* ── LIST VIEW ── */
                <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-x-auto">
                    <table className="w-full text-left border-collapse" style={{ minWidth: '760px' }}>
                        <thead>
                            <tr className="bg-neutral-50 border-b border-neutral-200">
                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500 w-14">Item</th>
                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500 w-40">Código</th>
                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Descrição</th>
                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500 text-center w-28">Estoque</th>
                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500 text-right w-32">Preço</th>
                                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500 text-center w-52">Ação</th>
                            </tr>
                        </thead>
                        <tbody>
                            {resultados.map(part => {
                                const corrimao = isCorrimao(part);
                                const mm = mmValues[part.codigo] || '';
                                return (
                                    <tr
                                        key={part.codigo}
                                        onClick={(e) => { if (e.target.closest('button, input')) return; setSelectedPart(part); }}
                                        className="border-b border-neutral-200 hover:bg-neutral-50 transition-colors group cursor-pointer"
                                    >
                                        {/* Thumb */}
                                        <td className="px-4 py-3">
                                            <div className="w-10 h-10 rounded bg-neutral-50 border border-neutral-200 overflow-hidden flex items-center justify-center flex-shrink-0">
                                                {part.url_imagem ? (
                                                    <img src={part.url_imagem} alt={part.descricao} loading="lazy" className="w-full h-full object-contain" />
                                                ) : (
                                                    <ImageIcon size={16} className="text-neutral-300" />
                                                )}
                                            </div>
                                        </td>

                                        {/* Código */}
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold border ${getCategoryStyles(part.codigo)}`}>
                                                {part.codigo}
                                            </span>
                                        </td>

                                        {/* Descrição */}
                                        <td className="px-4 py-3">
                                            <p className="text-black font-medium text-sm leading-relaxed">{part.descricao}</p>
                                            {corrimao && (
                                                <p className="text-[10px] text-amber-600 font-medium mt-0.5 flex items-center gap-1">
                                                    <Ruler size={10} /> Vendido por metro — estoque em mm
                                                </p>
                                            )}
                                        </td>

                                        {/* Estoque */}
                                        <td className="px-4 py-3 text-center">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold border ${part.estoque > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                                {part.estoque || 0}{corrimao ? ' mm' : ''}
                                            </span>
                                        </td>

                                        {/* Preço */}
                                        <td className="px-4 py-3 text-right">
                                            <span className="text-green-600 font-bold text-sm">{formatarMoeda(part.preco)}</span>
                                            {corrimao && <span className="text-[10px] text-neutral-400 block">/metro</span>}
                                        </td>

                                        {/* Ação */}
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2 justify-center">
                                                {corrimao ? (
                                                    /* Campo mm compacto */
                                                    <MmInput value={mm} onChange={v => setMm(part.codigo, v)} preco={part.preco} compact />
                                                ) : (
                                                    <QtyControl
                                                        value={quantities[part.codigo] || 1}
                                                        onDec={() => updateQty(part.codigo, -1)}
                                                        onInc={() => updateQty(part.codigo, 1)}
                                                        size="sm"
                                                    />
                                                )}
                                                <button
                                                    onClick={() => addToCart(part)}
                                                    disabled={corrimao && !mmValues[part.codigo]}
                                                    className={`p-2 rounded transition-all active:scale-95 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed
                                                        ${addedFeedback[part.codigo] ? 'bg-green-600 text-white' : 'bg-primary text-black hover:bg-primary-light'}`}
                                                    title={corrimao && !mm ? 'Informe a medida em mm' : 'Adicionar ao carrinho'}
                                                >
                                                    {addedFeedback[part.codigo] ? <Check size={16} /> : <ShoppingCart size={16} />}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* CartSidebar via portal → sem interferência de overflow ancestral */}
            {cartPortal}

            {/* Modal de Detalhes do Produto */}
            {selectedPart && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
                    <div
                        className="bg-white w-full max-w-2xl rounded-xl overflow-hidden shadow-xl border border-neutral-200 flex flex-col md:flex-row"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Imagem */}
                        <div className="w-full md:w-1/2 bg-neutral-50 flex items-center justify-center p-8 border-b md:border-b-0 md:border-r border-neutral-200">
                            {selectedPart.url_imagem ? (
                                <img src={selectedPart.url_imagem} alt={selectedPart.descricao} className="max-w-full max-h-[300px] object-contain" />
                            ) : (
                                <ImageIcon size={80} className="text-neutral-300" />
                            )}
                        </div>

                        {/* Infos */}
                        <div className="w-full md:w-1/2 p-8 flex flex-col">
                            <div className="flex justify-between items-start mb-4">
                                <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-1 rounded border ${getCategoryStyles(selectedPart.codigo)}`}>
                                    {selectedPart.categoria}
                                </span>
                                <button onClick={() => setSelectedPart(null)} className="w-8 h-8 flex items-center justify-center rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-500 hover:text-black transition-colors">
                                    <span className="text-xl leading-none">×</span>
                                </button>
                            </div>

                            <span className="text-[11px] font-mono text-neutral-400 mb-1">{selectedPart.codigo}</span>
                            <h2 className="font-display text-2xl text-black mb-4 leading-tight">{selectedPart.descricao}</h2>

                            <div className="space-y-3 mb-6">
                                <div className="flex justify-between items-center">
                                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">{isCorrimao(selectedPart) ? 'Preço por metro' : 'Preço Unitário'}</span>
                                    <span className="text-xl font-bold text-green-600">{formatarMoeda(selectedPart.preco)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">Estoque Disponível</span>
                                    <span className={`font-bold ${selectedPart.estoque > 0 ? 'text-green-600' : 'text-danger'}`}>
                                        {selectedPart.estoque || 0} {isCorrimao(selectedPart) ? 'mm' : 'unidades'}
                                    </span>
                                </div>
                            </div>

                            <div className="mt-auto space-y-4">
                                {isCorrimao(selectedPart) ? (
                                    <div className="bg-amber-50 p-4 rounded border border-amber-200">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-600 mb-2 flex items-center gap-1.5">
                                            <Ruler size={13} /> Informe a medida desejada em mm
                                        </p>
                                        <MmInput
                                            value={mmValues[selectedPart.codigo] || ''}
                                            onChange={v => setMm(selectedPart.codigo, v)}
                                            preco={selectedPart.preco}
                                        />
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-4 justify-between bg-neutral-50 p-3 rounded border border-neutral-200">
                                        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-500">Quantidade</span>
                                        <QtyControl
                                            value={quantities[selectedPart.codigo] || 1}
                                            onDec={() => updateQty(selectedPart.codigo, -1)}
                                            onInc={() => updateQty(selectedPart.codigo, 1)}
                                            size="lg"
                                        />
                                    </div>
                                )}

                                <button
                                    onClick={() => { addToCart(selectedPart); setSelectedPart(null); }}
                                    disabled={isCorrimao(selectedPart) && !mmValues[selectedPart.codigo]}
                                    className="w-full py-3.5 rounded bg-primary text-black text-sm font-bold hover:bg-primary-light hover:shadow-brand-sm transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <ShoppingCart size={18} />
                                    {isCorrimao(selectedPart) ? 'Adicionar Produto ao Carrinho' : 'Adicionar ao Carrinho'}
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="absolute inset-0 z-[-1]" onClick={() => setSelectedPart(null)} />
                </div>,
                document.body
            )}
            {cartPortal}
            {zeroStockModal}
        </div>
    );
}
