import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Package, Calendar, Filter, RefreshCw, Building2, CreditCard, History, AlertTriangle, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

function StatusBadge({ status, numero, label }) {
    if (status === 'ok') return (
        <div className="flex items-center gap-1.5">
            <CheckCircle size={16} className="text-green-600 shrink-0" />
            <div>
                <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-[0.1em] leading-none mb-0.5">{label}</p>
                <p className="text-sm font-bold text-green-600">Nº {numero ?? '—'}</p>
            </div>
        </div>
    );
    if (status === 'erro') return (
        <div className="flex items-center gap-1.5">
            <XCircle size={16} className="text-danger shrink-0" />
            <div>
                <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-[0.1em] leading-none mb-0.5">{label}</p>
                <p className="text-sm font-bold text-danger">Erro</p>
            </div>
        </div>
    );
    return (
        <div className="flex items-center gap-1.5">
            <Clock size={16} className="text-neutral-400 shrink-0" />
            <div>
                <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-[0.1em] leading-none mb-0.5">{label}</p>
                <p className="text-sm font-bold text-neutral-400">Pendente</p>
            </div>
        </div>
    );
}

const BRL = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

function formatDateBR(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR');
}

function OrderRow({ order, onAudit, auditing }) {
    const [expanded, setExpanded] = useState(false);
    const date = new Date(order.criadoEm);
    const dateStr = date.toLocaleDateString('pt-BR');
    const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const overallOk = order.pedido_compra?.status === 'ok' && order.pedido_venda?.status === 'ok';
    const overallErr = order.pedido_compra?.status === 'erro' || order.pedido_venda?.status === 'erro';
    const contasPagar = order.financeiro?.compra || null;
    const auditoria = order.auditoria_omie || null;

    return (
        <div className={`rounded-xl border shadow-card transition-colors ${overallOk ? 'border-green-200 bg-green-50/40' : overallErr ? 'border-red-200 bg-red-50/40' : 'border-neutral-200 bg-white'}`}>
            {/* Header row */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full px-5 py-4 flex items-center gap-4 text-left"
            >
                {/* Date */}
                <div className="shrink-0 w-28">
                    <p className="text-sm font-bold text-black">{dateStr}</p>
                    <p className="text-xs text-neutral-500">{timeStr}</p>
                </div>

                {/* Unidade */}
                <div className="shrink-0 w-28">
                    <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-[0.1em] mb-0.5">Unidade</p>
                    <span className="inline-block text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded bg-primary/15 text-primary-dark border border-primary/30">
                        {order.unidade}
                    </span>
                </div>

                {/* Itens */}
                <div className="shrink-0 w-16 text-center">
                    <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-[0.1em] mb-0.5">Itens</p>
                    <p className="text-sm font-bold text-black">{order.itens?.length ?? 0}</p>
                </div>

                {/* Status Compra (Escamax) */}
                <div className="flex-1">
                    <StatusBadge
                        status={order.pedido_compra?.status}
                        numero={order.pedido_compra?.numero}
                        label="Req. Compra Escamax"
                    />
                </div>

                {/* Status Venda (VP) */}
                <div className="flex-1">
                    <StatusBadge
                        status={order.pedido_venda?.status}
                        numero={order.pedido_venda?.numero}
                        label="Pedido Venda VP"
                    />
                </div>

                {/* Expand chevron */}
                <div className="shrink-0 text-neutral-400">
                    {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
            </button>

            {/* Expanded detail */}
            {expanded && (
                <div className="px-5 pb-4 border-t border-neutral-200 pt-3">
                    {/* Erros */}
                    {order.pedido_compra?.status === 'erro' && (
                        <div className="mb-3 p-3 rounded bg-red-50 border border-red-200">
                            <p className="text-[11px] font-bold text-danger uppercase tracking-[0.1em] mb-1">Detalhe do erro — Req. Compra Escamax</p>
                            <p className="text-xs text-neutral-700 break-words">{order.pedido_compra.detalhe}</p>
                        </div>
                    )}
                    {order.pedido_venda?.status === 'erro' && (
                        <div className="mb-3 p-3 rounded bg-red-50 border border-red-200">
                            <p className="text-[11px] font-bold text-danger uppercase tracking-[0.1em] mb-1">Detalhe do erro — Pedido Venda VP</p>
                            <p className="text-xs text-neutral-700 break-words">{order.pedido_venda.detalhe}</p>
                        </div>
                    )}

                    {contasPagar?.status === 'confirmado_por_pedido_compra' && (
                        <div className="mb-3 p-3 rounded bg-green-50 border border-green-200">
                            <div className="flex items-center gap-2 mb-2">
                                <CreditCard size={14} className="text-green-700 shrink-0" />
                                <p className="text-[11px] font-bold text-green-700 uppercase tracking-[0.1em]">
                                    Contas a pagar Escamax para VerticalParts
                                </p>
                            </div>
                            <p className="text-xs font-semibold text-green-800">
                                Lastro: Pedido de Compra Nº {contasPagar.pedidoCompraNumero || order.pedido_compra?.numero || '-'} · {BRL(contasPagar.total)} em {contasPagar.qtdeParcelas} parcela(s)
                            </p>
                            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                                {(contasPagar.parcelas || []).map(parcela => (
                                    <div key={parcela.numero} className="rounded border border-green-100 bg-white px-2 py-1 text-[11px] font-semibold text-green-900">
                                        {parcela.numero}/{contasPagar.qtdeParcelas} · {BRL(parcela.valor)} · {formatDateBR(parcela.data)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mb-3 flex justify-end">
                        <button
                            type="button"
                            onClick={() => onAudit(order)}
                            disabled={auditing}
                            className="inline-flex items-center gap-2 rounded border border-neutral-200 bg-white px-3 py-1.5 text-xs font-bold text-neutral-700 transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <RefreshCw size={13} className={auditing ? 'animate-spin' : ''} />
                            Reauditar Omie
                        </button>
                    </div>

                    {auditoria && (
                        <div className={`mb-3 p-3 rounded border ${auditoria.status === 'verificado' ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                            <p className={`text-[11px] font-bold uppercase tracking-[0.1em] mb-1 ${auditoria.status === 'verificado' ? 'text-blue-700' : 'text-amber-700'}`}>
                                Auditoria Omie
                            </p>
                            {auditoria.status === 'verificado' ? (
                                <div className="grid gap-2 text-xs font-semibold text-blue-900 sm:grid-cols-2">
                                    <div>
                                        Compra Escamax: {auditoria.compraEscamax?.existe ? 'localizada' : 'não localizada'} · {auditoria.compraEscamax?.parcelas || '-'} parcela(s)
                                    </div>
                                    <div>
                                        Venda VP: {auditoria.vendaVerticalParts?.existe ? 'localizada' : 'não localizada'} · etapa {auditoria.vendaVerticalParts?.etapa || '-'}
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs font-semibold text-amber-800">{auditoria.detalhe || 'Verificação pendente.'}</p>
                            )}
                        </div>
                    )}

                    {order.pedido_venda?.etapa_sync_status === 'erro' && (
                        <div className="mb-3 p-3 rounded bg-amber-50 border border-amber-200">
                            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-[0.1em] mb-1">
                                Sincronização de etapa VP pendente
                            </p>
                            <p className="text-xs font-semibold text-amber-800">
                                {order.pedido_venda.etapa_sync_detalhe || 'A etapa do Pedido de Venda VP precisa ser revisada no Omie.'}
                            </p>
                        </div>
                    )}

                    {/* Itens */}
                    <p className="text-[11px] font-bold text-neutral-400 mb-2 uppercase tracking-[0.1em]">Itens do pedido</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {(order.itens || []).map((item, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded bg-neutral-50 border border-neutral-200">
                                <Package size={14} className="text-neutral-400 shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-xs font-mono text-primary-dark truncate">{item.codigo}</p>
                                    <p className="text-[11px] text-neutral-500">{item.quantidade}× · R$ {Number(item.preco_unitario || 0).toFixed(2)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Compras na VerticalParts (Omie) — retroativo desde 01/2024 ────────────────
// Estritamente isolado pela filial ativa na sidebar. Nunca mistura dados de
// filiais diferentes: cada card mostra somente o histórico da filial selecionada.
function ComprasHistoricoOmie() {
    const { filial, user } = useAuth();
    const token = localStorage.getItem('token');
    const [itens, setItens] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [excluindo, setExcluindo] = useState(false);
    const [error, setError] = useState(null);

    const carregar = useCallback(async () => {
        if (!filial?.id) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/compras-historico?unidade=${filial.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
            setItens(await res.json());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [filial?.id, token]);

    // Recarrega sempre que a filial ativa (seletor da sidebar) mudar
    useEffect(() => { carregar(); }, [carregar]);

    const sincronizar = async () => {
        if (!filial?.id) return;
        setSyncing(true);
        try {
            await fetch(`${API_BASE}/api/compras-historico/sync?unidade=${filial.id}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            await carregar();
        } catch (e) {
            setError(e.message);
        } finally {
            setSyncing(false);
        }
    };

    const excluir = async () => {
        if (!filial?.id) return;
        if (!window.confirm(`Excluir o histórico de compras em cache da filial ${filial.label}? Isso não apaga nada no Omie — pode ser reconstruído clicando em "Sincronizar" depois.`)) {
            return;
        }
        setExcluindo(true);
        try {
            const res = await fetch(`${API_BASE}/api/compras-historico?unidade=${filial.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
            await carregar();
        } catch (e) {
            setError(e.message);
        } finally {
            setExcluindo(false);
        }
    };

    const total = useMemo(() => itens.reduce((s, i) => s + Number(i.valor || 0), 0), [itens]);

    return (
        <div className="mb-8 rounded-xl border border-neutral-200 bg-white shadow-card">
            <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-5 py-4">
                <div>
                    <div className="flex items-center gap-2">
                        <History size={16} className="text-primary-dark" />
                        <h2 className="font-display text-lg text-black">Compras na VerticalParts</h2>
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5">
                        Filial <strong>{filial?.label || '—'}</strong> · desde 01/2024 · fonte: Omie
                        {itens.length > 0 && (
                            <span className="ml-2 text-neutral-400">
                                {itens.length} item(ns) · {BRL(total)}
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={sincronizar}
                        disabled={syncing}
                        className="flex items-center gap-2 px-3 py-1.5 rounded bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-semibold border border-neutral-200 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                        Sincronizar
                    </button>
                    {user?.admin && (
                        <button
                            onClick={excluir}
                            disabled={excluindo || itens.length === 0}
                            title="Excluir histórico em cache desta filial (admin)"
                            className="flex items-center gap-2 px-3 py-1.5 rounded bg-white hover:bg-red-50 text-danger text-xs font-semibold border border-red-200 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Trash2 size={13} />
                            Excluir histórico
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="p-5 space-y-2">
                    {[1, 2, 3].map(i => <div key={i} className="h-8 rounded bg-neutral-50 animate-pulse" />)}
                </div>
            ) : error ? (
                <div className="p-5 flex items-center gap-2 text-sm font-semibold text-danger">
                    <AlertTriangle size={15} className="shrink-0" />
                    {error}
                </div>
            ) : itens.length === 0 ? (
                <div className="p-8 text-center text-neutral-400 text-sm">
                    Nenhuma compra da filial {filial?.label} na VerticalParts encontrada desde 01/2024.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-neutral-100 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                <th className="px-5 py-2 text-left">Código</th>
                                <th className="px-5 py-2 text-left">Descrição</th>
                                <th className="px-5 py-2 text-right">Valor</th>
                                <th className="px-5 py-2 text-right">Data</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-50">
                            {itens.map((item, i) => (
                                <tr key={`${item.numero_pedido}-${item.codigo_produto}-${i}`} className="hover:bg-neutral-50">
                                    <td className="px-5 py-2 font-mono text-xs text-neutral-500">{item.codigo_produto}</td>
                                    <td className="px-5 py-2 text-neutral-800">{item.descricao}</td>
                                    <td className="px-5 py-2 text-right font-semibold text-neutral-800">{BRL(item.valor)}</td>
                                    <td className="px-5 py-2 text-right text-neutral-500">{formatDateBR(item.data_pedido)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default function HistoryPage() {
    const token = localStorage.getItem('token');
    const [allOrders, setAllOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [auditError, setAuditError] = useState('');
    const [auditingId, setAuditingId] = useState('');
    const [lastUpdated, setLastUpdated] = useState(null);

    // Filtros de data
    const today = new Date().toISOString().slice(0, 10);
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const [de, setDe] = useState(firstOfMonth);
    const [ate, setAte] = useState(today);

    // Filtro de unidade (client-side)
    const [unidadeFiltro, setUnidadeFiltro] = useState('Todas');

    // Busca pedidos do servidor — só dispara quando explicitamente chamado
    const fetchOrders = useCallback(async (fromDate, toDate) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (fromDate) params.set('de', fromDate);
            if (toDate) params.set('ate', toDate);
            const res = await fetch(`${API_BASE}/api/orders?${params}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error(`Erro ${res.status}`);
            const data = await res.json();
            setAllOrders(data);
            setLastUpdated(new Date());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    // Carrega apenas na montagem inicial
    useEffect(() => { fetchOrders(firstOfMonth, today); }, []);  // eslint-disable-line

    // Lista de unidades únicas para o dropdown
    const unidades = useMemo(() => {
        const set = new Set(allOrders.map(o => o.unidade).filter(Boolean));
        return ['Todas', ...Array.from(set).sort()];
    }, [allOrders]);

    // Pedidos filtrados por unidade (client-side)
    const orders = useMemo(() => {
        if (unidadeFiltro === 'Todas') return allOrders;
        return allOrders.filter(o => o.unidade === unidadeFiltro);
    }, [allOrders, unidadeFiltro]);

    const handleFiltrar = () => fetchOrders(de, ate);

    const handleAudit = async (order) => {
        setAuditError('');
        setAuditingId(order.id);
        try {
            const res = await fetch(`${API_BASE}/api/orders/${encodeURIComponent(order.id)}/auditoria-omie`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok && res.status !== 202) {
                throw new Error(data.error || `Erro ${res.status}`);
            }
            await fetchOrders(de, ate);
        } catch (e) {
            setAuditError(e.message || 'Erro ao reauditar pedido.');
        } finally {
            setAuditingId('');
        }
    };

    const inputCls = "bg-white border border-neutral-200 rounded px-3 py-1.5 text-sm text-black outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 transition";

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-2xl text-black">Histórico de Pedidos</h1>
                    <p className="text-sm text-neutral-500 mt-0.5">
                        Acompanhe o status de cada pedido nas contas Omie.
                        {lastUpdated && (
                            <span className="ml-2 text-neutral-400">
                                Atualizado às {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                    </p>
                </div>
                {/* Botão Atualizar */}
                <button
                    onClick={handleFiltrar}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-2 rounded bg-white hover:bg-neutral-50 text-neutral-700 text-sm font-semibold border border-neutral-200 transition-colors disabled:opacity-50 shrink-0"
                    title="Buscar pedidos novamente"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Atualizar
                </button>
            </div>

            <ComprasHistoricoOmie />

            {/* Filtros */}
            <div className="flex flex-wrap items-end gap-3 mb-6 p-4 rounded-xl border border-neutral-200 bg-white shadow-card">
                <Filter size={16} className="text-neutral-400 self-center" />

                {/* Filtro por data */}
                <div className="flex items-center gap-2">
                    <Calendar size={15} className="text-neutral-400" />
                    <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em]">De</label>
                    <input type="date" value={de} onChange={e => setDe(e.target.value)} className={inputCls} />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em]">Até</label>
                    <input type="date" value={ate} onChange={e => setAte(e.target.value)} className={inputCls} />
                </div>

                {/* Filtro por unidade */}
                <div className="flex items-center gap-2">
                    <Building2 size={15} className="text-neutral-400" />
                    <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em]">Unidade</label>
                    <select
                        value={unidadeFiltro}
                        onChange={e => setUnidadeFiltro(e.target.value)}
                        className={`${inputCls} cursor-pointer`}
                    >
                        {unidades.map(u => (
                            <option key={u} value={u}>{u}</option>
                        ))}
                    </select>
                </div>

                <button
                    onClick={handleFiltrar}
                    className="ml-auto px-4 py-1.5 rounded bg-primary hover:bg-primary-light text-sm font-bold text-black transition-colors"
                >
                    Filtrar
                </button>
            </div>

            {/* Contador de resultados */}
            {!loading && !error && allOrders.length > 0 && (
                <p className="text-xs text-neutral-400 mb-3">
                    {orders.length === allOrders.length
                        ? `${allOrders.length} pedido(s) no período`
                        : `${orders.length} de ${allOrders.length} pedido(s) · filtrado por ${unidadeFiltro}`}
                </p>
            )}

            {/* Lista */}
            {loading && (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-20 rounded-xl bg-white border border-neutral-200 animate-pulse" />
                    ))}
                </div>
            )}
            {error && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-danger text-sm font-semibold flex items-center justify-between gap-4">
                    <span>Erro ao carregar pedidos: {error}</span>
                    <button onClick={handleFiltrar} className="px-3 py-1 rounded bg-red-100 hover:bg-red-200 text-xs font-bold transition-colors shrink-0">
                        Tentar novamente
                    </button>
                </div>
            )}
            {auditError && (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    {auditError}
                </div>
            )}
            {!loading && !error && orders.length === 0 && (
                <div className="text-center py-16 text-neutral-400">
                    <Package size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">
                        {allOrders.length === 0
                            ? 'Nenhum pedido encontrado no período selecionado.'
                            : `Nenhum pedido para a unidade "${unidadeFiltro}" neste período.`}
                    </p>
                </div>
            )}
            {!loading && !error && orders.length > 0 && (
                <div className="space-y-3">
                    {orders.map(order => (
                        <OrderRow key={order.id} order={order} onAudit={handleAudit} auditing={auditingId === order.id} />
                    ))}
                </div>
            )}
        </div>
    );
}
