import React, { useState, useEffect, useCallback } from 'react';
import {
    Search, RefreshCw, Package, AlertTriangle, ChevronUp, ChevronDown,
    Lock, ShoppingCart, Plus, CheckCircle2, Loader2, XCircle, Tag,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchEstoqueVPMap, juntarEstoque } from '../lib/estoqueVP';

const SUPABASE_URL = 'https://hhgvlcskxopryqvhofsg.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZ3ZsY3NreG9wcnlxdmhvZnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3ODc0NjIsImV4cCI6MjA5MDM2MzQ2Mn0.Hzl6k-TM_U1Ae8cNUPtz8MFBbZ4EVF3EGOhvgV7xnqk';
const PREFIXOS_INTERNOS = ['VPCON', 'VPIN'];

function getCodigoVP(produto) {
    const codigo = String(produto?.codigo ?? '').trim();
    if (!/^VP/i.test(codigo)) return '';
    if (PREFIXOS_INTERNOS.some(prefix => codigo.toUpperCase().startsWith(prefix))) return '';
    return codigo;
}

// Catálogo vem de omie_produtos; o SALDO vem da tabela estoque_vp (fonte
// correta, sincronizada da Omie) — o estoque_atual do catálogo é furado.
async function fetchProdutos() {
    const [respProdutos, mapaEstoque] = await Promise.all([
        fetch(
            `${SUPABASE_URL}/rest/v1/omie_produtos?select=codigo_produto,codigo,descricao,unidade,valor_unitario,updated_at&ativo=eq.true&codigo=ilike.VP*&codigo=not.ilike.VPCON*&codigo=not.ilike.VPIN*&order=descricao.asc&limit=1000`,
            {
                headers: {
                    'apikey': SUPABASE_ANON,
                    'Authorization': `Bearer ${SUPABASE_ANON}`,
                }
            }
        ),
        fetchEstoqueVPMap(),
    ]);
    if (!respProdutos.ok) throw new Error(`Supabase ${respProdutos.status}`);
    const produtos = await respProdutos.json();
    return juntarEstoque(produtos, mapaEstoque);
}

async function triggerSync(token) {
    const resp = await fetch('/api/produtos-vp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    return resp.json();
}

function SortIcon({ col, sort }) {
    if (sort.col !== col) return <span className="ml-1 text-neutral-300">↕</span>;
    return sort.asc
        ? <ChevronUp className="inline h-3.5 w-3.5 ml-0.5 text-primary" />
        : <ChevronDown className="inline h-3.5 w-3.5 ml-0.5 text-primary" />;
}

// ── Gate: painel de validação do carrinho ────────────────────────────────────
function ValidacaoCarrinhoGate({ validacaoCarrinho, setValidacaoCarrinho, filial, finalidade, setFinalidade }) {
    const tipoValidacao = finalidade === 'Atendimento a Contrato' ? 'contrato' : 'pedido-venda';
    const isContrato = tipoValidacao === 'contrato';
    const [inputNumero, setInputNumero] = useState(validacaoCarrinho.numero || '');
    const [verificando, setVerificando] = useState(false);
    const [erro, setErro] = useState('');

    useEffect(() => {
        setInputNumero('');
        setErro('');
    }, [tipoValidacao, filial?.id]);

    const handleVerificar = async () => {
        const num = inputNumero.trim();
        if (!num) {
            setErro(isContrato ? 'Informe o número do contrato.' : 'Informe o número do pedido.');
            return;
        }
        if (!filial?.id) { setErro('Selecione uma filial antes.'); return; }

        setVerificando(true);
        setErro('');
        try {
            const token = localStorage.getItem('token');
            const endpoint = isContrato ? 'contrato' : 'pedido-venda';
            const resp = await fetch(
                `/api/omie/${endpoint}?numero=${encodeURIComponent(num)}&unidade=${filial.id}`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            const data = await resp.json();
            if (!resp.ok) {
                setErro(data.error || (isContrato ? 'Contrato não encontrado ou sem tag válida.' : 'Pedido não encontrado.'));
                setValidacaoCarrinho({ tipo: '', numero: '', validado: false });
                return;
            }
            setValidacaoCarrinho({
                tipo: tipoValidacao,
                numero: data.numero,
                vendedor: data.vendedor || '',
                valorTotal: Number(data.valorTotal || 0),
                limiteCompra70: Number(data.limiteCompra70 || 0),
                tagValida: data.tagValida || '',
                tags: data.tags || [],
                validado: true,
            });
        } catch (e) {
            setErro(isContrato ? 'Erro de conexão ao verificar contrato.' : 'Erro de conexão ao verificar pedido.');
            setValidacaoCarrinho({ tipo: '', numero: '', validado: false });
        } finally {
            setVerificando(false);
        }
    };

    const handleReset = () => {
        setInputNumero('');
        setErro('');
        setValidacaoCarrinho({ tipo: '', numero: '', validado: false });
    };

    // ── Estado: pedido já validado ────────────────────────────────────────────
    if (validacaoCarrinho.validado && validacaoCarrinho.tipo === tipoValidacao) {
        return (
            <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                    <div>
                        <p className="text-sm font-bold text-green-800">
                            {isContrato ? 'Contrato' : 'Pedido'} <span className="font-mono">{validacaoCarrinho.numero}</span> confirmado
                            {!isContrato && validacaoCarrinho.vendedor ? ` — Vendedor: ${validacaoCarrinho.vendedor}` : ''}
                            {isContrato && validacaoCarrinho.tagValida ? ` — Tag: ${validacaoCarrinho.tagValida}` : ''}
                        </p>
                        <p className="text-xs text-green-600">
                            Carrinho liberado · Filial: Escamax {filial?.label}
                        </p>
                        {!isContrato && validacaoCarrinho.valorTotal > 0 && (
                            <p className="text-xs text-green-700">
                                Proposta: {validacaoCarrinho.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                {' · '}Limite 70%: {validacaoCarrinho.limiteCompra70.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </p>
                        )}
                    </div>
                </div>
                <button
                    onClick={handleReset}
                    className="ml-4 shrink-0 text-xs font-semibold text-green-700 underline hover:text-green-900"
                >
                    Trocar {isContrato ? 'contrato' : 'pedido'}
                </button>
            </div>
        );
    }

    // ── Estado: aguardando validação ─────────────────────────────────────────
    return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
                {[
                    { value: 'Revenda', label: 'Revenda' },
                    { value: 'Atendimento a Contrato', label: 'Atendimento a Contrato' },
                ].map(option => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => setFinalidade(option.value)}
                        className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                            finalidade === option.value
                                ? 'border-primary bg-primary/20 text-black'
                                : 'border-amber-200 bg-white text-amber-700 hover:border-primary'
                        }`}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
            <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-amber-600 shrink-0" />
                <p className="text-sm font-bold text-amber-800">
                    {isContrato
                        ? 'Informe o Contrato para liberar o carrinho'
                        : 'Informe o Pedido de Venda para liberar o carrinho'
                    }
                </p>
            </div>
            <p className="text-xs text-amber-700">
                {isContrato ? (
                    <>
                        Atendimentos a contrato da filial <strong>Escamax {filial?.label}</strong> precisam estar vinculados
                        a um contrato existente com tag <strong>Contrato com peças</strong> ou <strong>Contrato Parcial com Peças</strong>.
                    </>
                ) : (
                    <>
                        Revendas da filial <strong>Escamax {filial?.label}</strong> precisam estar vinculadas
                        a um Pedido de Venda existente no Omie desta filial.
                    </>
                )}
            </p>
            <div className="flex gap-2">
                <input
                    type="text"
                    placeholder={isContrato ? 'Ex.: 2025/00123' : 'Ex.: 29088'}
                    value={inputNumero}
                    onChange={e => { setInputNumero(e.target.value); setErro(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleVerificar()}
                    className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                    onClick={handleVerificar}
                    disabled={verificando || !inputNumero.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-black transition hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {verificando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
                    {verificando ? 'Verificando...' : `Verificar ${isContrato ? 'Contrato' : 'Pedido'} no Omie`}
                </button>
            </div>
            {erro && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                    <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                    <p className="text-xs font-medium text-red-700">{erro}</p>
                </div>
            )}
        </div>
    );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function ProdutosVPPage({ cart = [], addToCart, finalidade, setFinalidade, validacaoCarrinho, setValidacaoCarrinho, onOpenCart }) {
    const { filial } = useAuth();
    const [produtos, setProdutos]   = useState([]);
    const [loading, setLoading]     = useState(true);
    const [syncing, setSyncing]     = useState(false);
    const [error, setError]         = useState(null);
    const [search, setSearch]       = useState('');
    const [syncMsg, setSyncMsg]     = useState(null);
    const [sort, setSort]           = useState({ col: 'descricao', asc: true });
    const [lastUpdate, setLastUpdate] = useState(null);
    const [addedCodes, setAddedCodes] = useState(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchProdutos();
            const produtosVP = data.filter(getCodigoVP);
            setProdutos(produtosVP);
            if (produtosVP.length > 0) {
                const latest = produtosVP.reduce((a, b) =>
                    new Date(a.updated_at) > new Date(b.updated_at) ? a : b
                );
                setLastUpdate(new Date(latest.updated_at));
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSync = async () => {
        setSyncing(true);
        setSyncMsg(null);
        try {
            const token = localStorage.getItem('token');
            const result = await triggerSync(token);
            setSyncMsg(result.ok
                ? `✓ ${result.synced} produtos sincronizados`
                : `Erro: ${result.errors?.join(', ') || result.error || 'falha no sync'}`
            );
            if (result.ok) await load();
        } catch (e) {
            setSyncMsg(`Erro: ${e.message}`);
        } finally {
            setSyncing(false);
        }
    };

    const handleAddToCart = (produto) => {
        if (!validacaoCarrinho?.validado || !addToCart) return;
        const codigoSku = getCodigoVP(produto);
        if (!codigoSku) return;

        addToCart({
            codigo: codigoSku,
            descricao: produto.descricao,
            unidade: produto.unidade,
            preco: produto.valor_unitario,
            preco_original: produto.valor_unitario,
            estoque: produto.estoque_disponivel,
        });
        // Feedback visual breve
        setAddedCodes(prev => new Set([...prev, produto.codigo_produto]));
        setTimeout(() => {
            setAddedCodes(prev => {
                const next = new Set(prev);
                next.delete(produto.codigo_produto);
                return next;
            });
        }, 1200);
    };

    const toggleSort = (col) => {
        setSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: true });
    };

    const filtered = produtos.filter(p =>
        p.descricao?.toLowerCase().includes(search.toLowerCase()) ||
        getCodigoVP(p).toLowerCase().includes(search.toLowerCase())
    );

    const sorted = [...filtered].sort((a, b) => {
        const av = a[sort.col] ?? '';
        const bv = b[sort.col] ?? '';
        if (typeof av === 'number') return sort.asc ? av - bv : bv - av;
        return sort.asc
            ? String(av).localeCompare(String(bv))
            : String(bv).localeCompare(String(av));
    });

    const estoqueZero = sorted.filter(p => p.estoque_disponivel !== null && p.estoque_disponivel <= 0).length;
    const totalNoCarrinho = cart.reduce((s, i) => s + i.quantity, 0);

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="vp-eyebrow">Catálogo</p>
                    <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-neutral-900">
                        Produtos VerticalParts
                    </h1>
                    {lastUpdate && (
                        <p className="mt-0.5 text-xs text-neutral-400">
                            Atualizado em {lastUpdate.toLocaleString('pt-BR')}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {totalNoCarrinho > 0 && (
                        <button
                            onClick={onOpenCart}
                            className="inline-flex items-center gap-2 rounded-xl border border-primary bg-primary/10 px-4 py-2 text-sm font-bold text-primary-dark shadow-card transition hover:bg-primary/20"
                        >
                            <ShoppingCart className="h-4 w-4" />
                            Ver Carrinho ({totalNoCarrinho})
                        </button>
                    )}
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-card transition hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                        <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                        {syncing ? 'Sincronizando...' : 'Sincronizar Agora'}
                    </button>
                </div>
            </div>

            {/* Gate de pedido de venda */}
            <ValidacaoCarrinhoGate
                validacaoCarrinho={validacaoCarrinho}
                setValidacaoCarrinho={setValidacaoCarrinho}
                filial={filial}
                finalidade={finalidade}
                setFinalidade={setFinalidade}
            />

            {/* Sync feedback */}
            {syncMsg && (
                <div className={`rounded-xl border px-4 py-2.5 text-sm ${
                    syncMsg.startsWith('✓')
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                }`}>
                    {syncMsg}
                </div>
            )}

            {/* Stats */}
            {!loading && !error && (
                <div className="grid grid-cols-3 gap-3">
                    {[
                        { label: 'Total de Produtos', value: produtos.length, gold: true },
                        { label: 'Com Estoque', value: produtos.length - estoqueZero, color: 'text-green-600' },
                        { label: 'Sem Estoque', value: estoqueZero, color: estoqueZero > 0 ? 'text-red-500' : 'text-neutral-400' },
                    ].map(({ label, value, gold, color }) => (
                        <div key={label} className="rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-card">
                            <p className="text-xs text-neutral-400">{label}</p>
                            <p className={`text-2xl font-bold ${gold ? 'text-primary-dark' : color}`}>
                                {value.toLocaleString('pt-BR')}
                            </p>
                        </div>
                    ))}
                </div>
            )}

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                    type="text"
                    placeholder="Buscar por código ou descrição..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-10 pr-4 text-sm shadow-card outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card">
                {loading ? (
                    <div className="flex items-center justify-center gap-3 py-16 text-neutral-400">
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        <span className="text-sm">Carregando produtos...</span>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                        <AlertTriangle className="h-8 w-8 text-red-400" />
                        <p className="text-sm font-medium text-red-600">Erro ao carregar produtos</p>
                        <p className="text-xs text-neutral-400">{error}</p>
                        <button onClick={load} className="mt-2 text-xs text-primary underline">Tentar novamente</button>
                    </div>
                ) : sorted.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                        <Package className="h-10 w-10 text-neutral-200" />
                        <p className="text-sm font-medium text-neutral-500">
                            {search ? 'Nenhum produto encontrado' : 'Lista vazia — clique em Sincronizar Agora'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-100 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                    {[
                                        { key: 'codigo', label: 'Código VP' },
                                        { key: 'descricao',      label: 'Descrição' },
                                        { key: 'unidade',        label: 'Un.' },
                                        { key: 'estoque_disponivel', label: 'Estoque' },
                                        { key: 'valor_unitario', label: 'Valor Unit.' },
                                    ].map(({ key, label }) => (
                                        <th
                                            key={key}
                                            onClick={() => toggleSort(key)}
                                            className="cursor-pointer select-none px-4 py-3 text-left hover:text-primary transition-colors"
                                        >
                                            {label}<SortIcon col={key} sort={sort} />
                                        </th>
                                    ))}
                                    <th className="px-4 py-3 text-right">
                                        {validacaoCarrinho?.validado
                                            ? 'Adicionar'
                                            : <Lock className="inline h-3.5 w-3.5 text-neutral-400" />
                                        }
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-50">
                                {sorted.map((p) => {
                                    const codigoSku = getCodigoVP(p);
                                    const jaAdicionado = addedCodes.has(p.codigo_produto);
                                    const qtdNoCarrinho = cart.find(i => i.codigo === codigoSku)?.quantity || 0;
                                    const semEstoque = p.estoque_disponivel !== null && p.estoque_disponivel <= 0;
                                    const podeAdicionar = validacaoCarrinho?.validado && codigoSku && !semEstoque;

                                    return (
                                        <tr key={p.codigo_produto} className="hover:bg-neutral-50 transition-colors">
                                            <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                                                {codigoSku}
                                            </td>
                                            <td className="px-4 py-3 font-medium text-neutral-800">
                                                {p.descricao}
                                            </td>
                                            <td className="px-4 py-3 text-neutral-500">{p.unidade}</td>
                                            <td className="px-4 py-3">
                                                {p.estoque_disponivel === null ? (
                                                    <span
                                                        title="Código sem rastreio de saldo"
                                                        className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-400"
                                                    >
                                                        —
                                                    </span>
                                                ) : (
                                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                        p.estoque_disponivel > 0
                                                            ? 'bg-green-50 text-green-700'
                                                            : 'bg-red-50 text-red-600'
                                                    }`}>
                                                        {Number(p.estoque_disponivel).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-neutral-700">
                                                {Number(p.valor_unitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {podeAdicionar ? (
                                                    <button
                                                        onClick={() => handleAddToCart(p)}
                                                        title="Adicionar ao carrinho"
                                                        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-all active:scale-95 ${
                                                            jaAdicionado
                                                                ? 'bg-green-100 text-green-700'
                                                                : qtdNoCarrinho > 0
                                                                    ? 'bg-primary/20 text-primary-dark hover:bg-primary/30'
                                                                    : 'bg-primary text-black hover:bg-primary-light'
                                                        }`}
                                                    >
                                                        {jaAdicionado ? (
                                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                                        ) : (
                                                            <Plus className="h-3.5 w-3.5" />
                                                        )}
                                                        {jaAdicionado
                                                            ? 'Adicionado!'
                                                            : qtdNoCarrinho > 0
                                                                ? `+1 (${qtdNoCarrinho})`
                                                                : 'Adicionar'
                                                        }
                                                    </button>
                                                ) : (
                                                    <span
                                                        title={semEstoque ? 'Produto sem estoque disponível' : 'Informe o pedido de venda para liberar'}
                                                        className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-neutral-300 cursor-not-allowed"
                                                    >
                                                        <Lock className="h-3.5 w-3.5" />
                                                        {semEstoque ? 'Sem estoque' : 'Bloqueado'}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div className="border-t border-neutral-100 px-4 py-2.5 text-xs text-neutral-400">
                            {sorted.length} de {produtos.length} produto{produtos.length !== 1 ? 's' : ''}
                            {search && ` — filtrando por "${search}"`}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
