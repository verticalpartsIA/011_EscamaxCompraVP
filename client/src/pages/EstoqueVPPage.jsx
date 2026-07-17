import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, Package, AlertTriangle, ChevronUp, ChevronDown, Boxes } from 'lucide-react';
import { codigoRastreado } from '../lib/estoqueVP';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Lido via backend autenticado (GET /api/estoque/vp) — estoque_vp não tem mais
// policy de leitura pública (issue #48). Tela mostra só VPEL/VPER/VPB por decisão
// do usuário — a tabela em si tem mais códigos (corrimões etc.) porque também
// alimentava a busca antiga "Consultar Peças" (removida, ver issue #32).
async function fetchEstoqueVP() {
    const token = localStorage.getItem('token');
    const resp = await fetch(`${API_BASE}/api/estoque/vp`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Erro ao consultar estoque VerticalParts (${resp.status})`);
    const todos = await resp.json();
    return todos.filter(row => codigoRastreado(row.codigo));
}

function SortIcon({ col, sort }) {
    if (sort.col !== col) return <span className="ml-1 text-neutral-300">↕</span>;
    return sort.asc
        ? <ChevronUp className="inline h-3.5 w-3.5 ml-0.5 text-primary" />
        : <ChevronDown className="inline h-3.5 w-3.5 ml-0.5 text-primary" />;
}

const COLUNAS = [
    { key: 'codigo', label: 'Código do Produto' },
    { key: 'descricao', label: 'Descrição do Produto' },
    { key: 'estoque_fisico', label: 'Estoque Físico' },
    { key: 'reservado', label: 'Reservado' },
    { key: 'estoque_disponivel', label: 'Estoque Disponível' },
    { key: 'estoque_minimo', label: 'Estoque Mínimo' },
];

export default function EstoqueVPPage() {
    const [produtos, setProdutos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState({ col: 'descricao', asc: true });
    const [lastUpdate, setLastUpdate] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchEstoqueVP();
            setProdutos(data);
            if (data.length > 0) {
                const latest = data.reduce((a, b) => new Date(a.atualizado_em) > new Date(b.atualizado_em) ? a : b);
                setLastUpdate(new Date(latest.atualizado_em));
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggleSort = (col) => setSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: true });

    const filtered = produtos.filter(p =>
        p.descricao?.toLowerCase().includes(search.toLowerCase()) ||
        p.codigo?.toLowerCase().includes(search.toLowerCase())
    );

    const sorted = [...filtered].sort((a, b) => {
        const av = a[sort.col] ?? '';
        const bv = b[sort.col] ?? '';
        if (typeof av === 'number') return sort.asc ? av - bv : bv - av;
        return sort.asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });

    const semEstoque = sorted.filter(p => Number(p.estoque_disponivel) <= 0).length;
    const abaixoMinimo = sorted.filter(p => Number(p.estoque_disponivel) < Number(p.estoque_minimo)).length;

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="vp-eyebrow">Estoque</p>
                    <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-neutral-900">
                        Estoque VerticalParts
                    </h1>
                    {lastUpdate && (
                        <p className="mt-0.5 text-xs text-neutral-400">
                            Atualizado em {lastUpdate.toLocaleString('pt-BR')} · sincroniza a cada hora, em horário comercial
                        </p>
                    )}
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-card transition hover:border-primary hover:text-primary disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    Atualizar
                </button>
            </div>

            {!loading && !error && (
                <div className="grid grid-cols-3 gap-3">
                    {[
                        { label: 'Total de Produtos', value: produtos.length, gold: true },
                        { label: 'Sem Estoque Disponível', value: semEstoque, color: semEstoque > 0 ? 'text-red-500' : 'text-neutral-400' },
                        { label: 'Abaixo do Mínimo', value: abaixoMinimo, color: abaixoMinimo > 0 ? 'text-amber-600' : 'text-neutral-400' },
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

            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card">
                {loading ? (
                    <div className="flex items-center justify-center gap-3 py-16 text-neutral-400">
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        <span className="text-sm">Carregando estoque...</span>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                        <AlertTriangle className="h-8 w-8 text-red-400" />
                        <p className="text-sm font-medium text-red-600">Erro ao carregar estoque</p>
                        <p className="text-xs text-neutral-400">{error}</p>
                        <button onClick={load} className="mt-2 text-xs text-primary underline">Tentar novamente</button>
                    </div>
                ) : sorted.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                        <Boxes className="h-10 w-10 text-neutral-200" />
                        <p className="text-sm font-medium text-neutral-500">
                            {search ? 'Nenhum produto encontrado' : 'Nenhum dado sincronizado ainda'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-100 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                    {COLUNAS.map(({ key, label }) => (
                                        <th
                                            key={key}
                                            onClick={() => toggleSort(key)}
                                            className="cursor-pointer select-none px-4 py-3 text-left hover:text-primary transition-colors"
                                        >
                                            {label}<SortIcon col={key} sort={sort} />
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-50">
                                {sorted.map((p) => {
                                    const abaixoDoMinimo = Number(p.estoque_disponivel) < Number(p.estoque_minimo);
                                    return (
                                        <tr key={p.codigo} className="hover:bg-neutral-50 transition-colors">
                                            <td className="px-4 py-3 font-mono text-xs text-neutral-500">{p.codigo}</td>
                                            <td className="px-4 py-3 font-medium text-neutral-800">{p.descricao}</td>
                                            <td className="px-4 py-3 text-neutral-700">
                                                {Number(p.estoque_fisico).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                                            </td>
                                            <td className="px-4 py-3 text-neutral-500">
                                                {Number(p.reservado).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                    Number(p.estoque_disponivel) > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                                                }`}>
                                                    {Number(p.estoque_disponivel).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                                                </span>
                                            </td>
                                            <td className={`px-4 py-3 ${abaixoDoMinimo ? 'font-semibold text-amber-600' : 'text-neutral-500'}`}>
                                                {Number(p.estoque_minimo).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
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
