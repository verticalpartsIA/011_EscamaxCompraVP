import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, AlertTriangle, Wrench, Search } from 'lucide-react';
import { listarRequisicoes } from '../lib/servicos';
import { STATUS_LABELS, STATUS_CLASSES, moeda } from '../lib/statusServicos';

export default function RequisicaoServicosPage() {
    const navigate = useNavigate();
    const [requisicoes, setRequisicoes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');

    const carregar = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setRequisicoes(await listarRequisicoes());
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { carregar(); }, [carregar]);

    const filtradas = requisicoes.filter(r =>
        r.title?.toLowerCase().includes(search.toLowerCase()) ||
        String(r.number).includes(search)
    );

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="vp-eyebrow">Serviços</p>
                    <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-neutral-900">
                        Requisição Serviços
                    </h1>
                    <p className="mt-1 text-xs text-neutral-500">
                        Contratação de serviço terceirizado — toda abertura passa pelo aval do CEO da VerticalParts.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={carregar}
                        disabled={loading}
                        className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-card transition hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Atualizar
                    </button>
                    <button
                        onClick={() => navigate('/requisicao-servicos/nova')}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black shadow-card transition hover:bg-primary-light"
                    >
                        <Plus className="h-4 w-4" />
                        Nova Requisição
                    </button>
                </div>
            </div>

            <div className="relative">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                    type="text"
                    placeholder="Buscar por número ou título..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-10 pr-4 text-sm shadow-card outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
            </div>

            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card">
                {loading ? (
                    <div className="flex items-center justify-center gap-3 py-16 text-neutral-400">
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        <span className="text-sm">Carregando requisições...</span>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                        <AlertTriangle className="h-8 w-8 text-red-400" />
                        <p className="text-sm font-medium text-red-600">Erro ao carregar requisições</p>
                        <p className="text-xs text-neutral-400">{error}</p>
                        <button onClick={carregar} className="mt-2 text-xs text-primary underline">Tentar novamente</button>
                    </div>
                ) : filtradas.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                        <Wrench className="h-10 w-10 text-neutral-200" />
                        <p className="text-sm font-medium text-neutral-500">
                            {search ? 'Nenhuma requisição encontrada' : 'Nenhuma requisição ainda — clique em Nova Requisição'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-100 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                    <th className="px-4 py-3 text-left">Nº</th>
                                    <th className="px-4 py-3 text-left">Título</th>
                                    <th className="px-4 py-3 text-left">Status</th>
                                    <th className="px-4 py-3 text-right">Valor</th>
                                    <th className="px-4 py-3 text-left">Criada em</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-50">
                                {filtradas.map(r => (
                                    <tr
                                        key={r.id}
                                        onClick={() => navigate(`/requisicao-servicos/${r.id}`)}
                                        className="cursor-pointer hover:bg-neutral-50 transition-colors"
                                    >
                                        <td className="px-4 py-3 font-mono text-xs text-neutral-500">#{r.number}</td>
                                        <td className="px-4 py-3 font-medium text-neutral-800">
                                            {r.title}
                                            {r.is_urgent && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">URGENTE</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[r.status] || 'bg-neutral-100 text-neutral-600'}`}>
                                                {STATUS_LABELS[r.status] || r.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right text-neutral-700">{moeda(r.total_value)}</td>
                                        <td className="px-4 py-3 text-neutral-500">{new Date(r.created_at).toLocaleDateString('pt-BR')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="border-t border-neutral-100 px-4 py-2.5 text-xs text-neutral-400">
                            {filtradas.length} de {requisicoes.length} requisiç{requisicoes.length !== 1 ? 'ões' : 'ão'}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
