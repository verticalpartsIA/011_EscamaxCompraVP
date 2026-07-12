import React, { useState, useEffect, useCallback } from 'react';
import { PackageX, RefreshCw, AlertTriangle, Search } from 'lucide-react';
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
// correta, sincronizada da Omie). Filtra aqui os itens rastreados com saldo
// disponível zerado ou negativo — o estoque_atual do catálogo é furado.
async function fetchSemEstoque() {
    const [resp, mapaEstoque] = await Promise.all([
        fetch(
            `${SUPABASE_URL}/rest/v1/omie_produtos?select=codigo_produto,codigo,descricao,unidade,valor_unitario,updated_at&ativo=eq.true&codigo=ilike.VP*&codigo=not.ilike.VPCON*&codigo=not.ilike.VPIN*&order=descricao.asc&limit=2000`,
            {
                headers: {
                    'apikey': SUPABASE_ANON,
                    'Authorization': `Bearer ${SUPABASE_ANON}`,
                },
            }
        ),
        fetchEstoqueVPMap(),
    ]);
    if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
    const produtos = await resp.json();
    return juntarEstoque(produtos, mapaEstoque)
        .filter(p => p.estoque_disponivel !== null && p.estoque_disponivel <= 0);
}

export default function PecasSemEstoquePage() {
    const [produtos, setProdutos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');

    const carregar = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchSemEstoque();
            setProdutos(data.filter(p => getCodigoVP(p)));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { carregar(); }, [carregar]);

    const filtrados = produtos.filter(p =>
        p.descricao?.toLowerCase().includes(search.toLowerCase()) ||
        p.codigo?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="max-w-4xl mx-auto space-y-5">
            {/* Cabeçalho */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="font-display text-2xl text-black flex items-center gap-2">
                        <PackageX size={22} className="text-amber-500" />
                        Peças Sem Estoque
                    </h2>
                    <p className="text-sm text-neutral-500 mt-0.5">
                        {loading
                            ? 'Carregando...'
                            : `${filtrados.length} produto${filtrados.length !== 1 ? 's' : ''} da VerticalParts com estoque zerado.`}
                    </p>
                </div>
                <button
                    onClick={carregar}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-card transition hover:border-primary hover:text-primary disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    Atualizar
                </button>
            </div>

            {/* Busca */}
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

            {loading ? (
                <div className="space-y-2">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-12 rounded-xl bg-white border border-neutral-200 animate-pulse" />)}
                </div>
            ) : error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
                    <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-red-400" />
                    <p className="text-sm font-medium text-red-600">Erro ao carregar produtos sem estoque</p>
                    <p className="text-xs text-neutral-400 mt-1">{error}</p>
                    <button onClick={carregar} className="mt-3 text-xs text-primary underline">Tentar novamente</button>
                </div>
            ) : filtrados.length === 0 ? (
                <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-12 text-center">
                    <PackageX size={48} className="text-neutral-300 mx-auto mb-4" />
                    <p className="font-display text-xl text-black">
                        {search ? 'Nenhum resultado para essa busca' : 'Nenhuma peça sem estoque no momento'}
                    </p>
                    <p className="text-neutral-400 text-sm mt-1">
                        Assim que um produto VerticalParts zerar o estoque, ele aparece aqui automaticamente.
                    </p>
                </div>
            ) : (
                <div className="rounded-xl border border-neutral-200 bg-white shadow-card overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-neutral-200 bg-neutral-50">
                                <th className="text-left px-5 py-3 text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em]">Código</th>
                                <th className="text-left px-5 py-3 text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em]">Descrição</th>
                                <th className="text-center px-5 py-3 text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em]">Un.</th>
                                <th className="text-right px-5 py-3 text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em]">Valor Unit.</th>
                                <th className="text-center px-5 py-3 text-[11px] font-bold text-neutral-500 uppercase tracking-[0.1em]">Estoque</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtrados.map((p) => (
                                <tr key={p.codigo_produto} className="border-b border-neutral-100 hover:bg-neutral-50 transition-colors">
                                    <td className="px-5 py-3">
                                        <span className="font-mono text-amber-700 font-bold text-xs">{p.codigo}</span>
                                    </td>
                                    <td className="px-5 py-3 text-neutral-700 text-xs">{p.descricao}</td>
                                    <td className="px-5 py-3 text-center text-neutral-500 text-xs">{p.unidade}</td>
                                    <td className="px-5 py-3 text-right text-neutral-700 text-xs">
                                        {Number(p.valor_unitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                    </td>
                                    <td className="px-5 py-3 text-center">
                                        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
                                            {Number(p.estoque_disponivel).toLocaleString('pt-BR')}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
