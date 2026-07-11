import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    AlertTriangle, Loader2, Send, CheckCircle2, XCircle, RotateCcw,
    Paperclip, Upload, MessageSquare, Ban, ShieldCheck,
} from 'lucide-react';
import {
    obterRequisicao, enviarRequisicao, decidirCeo, decidirDiretor,
    iniciarAnaliseFinanceira, decidirFinanceiro, reenviarFinanceiro,
    cancelarRequisicao, comentarRequisicao, enviarAnexoRequisicao, urlAnexoRequisicao,
} from '../lib/servicos';
import { STATUS_LABELS, STATUS_CLASSES, ACTION_LABELS, moeda } from '../lib/statusServicos';

function DecisaoBox({ titulo, onDecidir, comAjuste = true }) {
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);

    const executar = async (decisao) => {
        setEnviando(true);
        try {
            await onDecidir(decisao, motivo);
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                <ShieldCheck className="h-4 w-4 text-primary-dark" /> {titulo}
            </h3>
            <textarea
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary"
                rows={2}
                placeholder="Justificativa (opcional para aprovar, recomendada para ajuste/rejeição)"
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
                <button disabled={enviando} onClick={() => executar('aprovar')} className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar
                </button>
                {comAjuste && (
                    <button disabled={enviando} onClick={() => executar('ajustar')} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50">
                        <RotateCcw className="h-3.5 w-3.5" /> Pedir Ajuste
                    </button>
                )}
                <button disabled={enviando} onClick={() => executar('rejeitar')} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50">
                    <XCircle className="h-3.5 w-3.5" /> Rejeitar
                </button>
            </div>
        </div>
    );
}

export default function RequisicaoServicoDetalhePage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [dados, setDados] = useState(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState('');
    const [acao, setAcao] = useState(false);
    const [novoComentario, setNovoComentario] = useState('');
    const [arquivo, setArquivo] = useState(null);

    const carregar = useCallback(async () => {
        setLoading(true);
        setErro('');
        try {
            setDados(await obterRequisicao(id));
        } catch (e) {
            setErro(e.message);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { carregar(); }, [carregar]);

    const rodar = async (fn) => {
        setAcao(true);
        setErro('');
        try {
            await fn();
            await carregar();
        } catch (e) {
            setErro(e.message);
        } finally {
            setAcao(false);
        }
    };

    const handleComentar = async () => {
        if (!novoComentario.trim()) return;
        await rodar(async () => {
            await comentarRequisicao(id, novoComentario.trim());
            setNovoComentario('');
        });
    };

    const handleUpload = async () => {
        if (!arquivo) return;
        await rodar(async () => {
            await enviarAnexoRequisicao(id, arquivo);
            setArquivo(null);
        });
    };

    const handleAbrirAnexo = async (attachmentId) => {
        try {
            const { url } = await urlAnexoRequisicao(id, attachmentId);
            window.open(url, '_blank');
        } catch (e) {
            setErro(e.message);
        }
    };

    if (loading) return <div className="py-16 text-center text-sm text-neutral-400">Carregando...</div>;
    if (erro && !dados) {
        return (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
                <AlertTriangle className="h-8 w-8 text-red-400" />
                <p className="text-sm font-medium text-red-600">{erro}</p>
            </div>
        );
    }
    if (!dados) return null;

    const { status, meuPapel, souSolicitante } = dados;
    const podeEnviar = souSolicitante && ['rascunho', 'ajuste_solicitante'].includes(status);
    const podeReenviarFinanceiro = souSolicitante && status === 'ajuste_pagamento';
    const podeCancelar = ['rascunho', 'aguardando_ceo', 'analise_diretor', 'ajuste_solicitante', 'aprovado_diretor', 'em_analise_financeiro', 'ajuste_pagamento'].includes(status)
        && (souSolicitante || meuPapel === 'admin');

    return (
        <div className="mx-auto max-w-3xl space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="vp-eyebrow">Serviços · #{dados.number}</p>
                    <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-neutral-900">{dados.title}</h1>
                </div>
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLASSES[status] || 'bg-neutral-100 text-neutral-600'}`}>
                    {STATUS_LABELS[status] || status}
                </span>
            </div>

            {erro && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-danger">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {erro}
                </div>
            )}

            <section className="grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card sm:grid-cols-2">
                <div>
                    <p className="text-xs text-neutral-400">Cliente</p>
                    <p className="text-sm font-medium text-neutral-800">{dados.cliente?.name || dados.cliente?.razao_social || '—'}</p>
                </div>
                <div>
                    <p className="text-xs text-neutral-400">Fornecedor Terceirizado</p>
                    <p className="text-sm font-medium text-neutral-800">{dados.fornecedor?.name || '—'}</p>
                </div>
                <div>
                    <p className="text-xs text-neutral-400">Valor Total</p>
                    <p className="text-sm font-bold text-neutral-900">{moeda(dados.total_value)}</p>
                </div>
                <div>
                    <p className="text-xs text-neutral-400">Condição de Pagamento</p>
                    <p className="text-sm font-medium text-neutral-800">Entrada {dados.entry_percent}% · Saldo: {dados.balance_term}</p>
                </div>
                {dados.justification && (
                    <div className="sm:col-span-2">
                        <p className="text-xs text-neutral-400">Justificativa</p>
                        <p className="text-sm text-neutral-700">{dados.justification}</p>
                    </div>
                )}
            </section>

            <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <h2 className="mb-2 text-sm font-bold text-neutral-900">Itens</h2>
                <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-neutral-500">
                        <tr>
                            <th className="pb-2 text-left">Descrição</th>
                            <th className="pb-2 text-right">Qtd</th>
                            <th className="pb-2 text-right">Preço Un.</th>
                            <th className="pb-2 text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-50">
                        {(dados.itens || []).map(item => (
                            <tr key={item.id}>
                                <td className="py-2">{item.description}</td>
                                <td className="py-2 text-right">{item.quantity}</td>
                                <td className="py-2 text-right">{moeda(item.unit_price)}</td>
                                <td className="py-2 text-right font-bold">{moeda(item.total_price)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            {/* Ações de fluxo, conforme papel e status atual */}
            {podeEnviar && (
                <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                    <button
                        disabled={acao}
                        onClick={() => rodar(() => enviarRequisicao(id))}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black hover:bg-primary-light disabled:opacity-50"
                    >
                        {acao ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Enviar para Aval do CEO
                    </button>
                </div>
            )}

            {status === 'aguardando_ceo' && meuPapel && (
                <DecisaoBox titulo="Aval do CEO (gate obrigatório)" onDecidir={(d, m) => rodar(() => decidirCeo(id, d, m))} />
            )}

            {status === 'analise_diretor' && (meuPapel === 'diretor_comercial' || meuPapel === 'admin') && (
                <DecisaoBox titulo="Análise do Diretor Comercial" onDecidir={(d, m) => rodar(() => decidirDiretor(id, d, m))} />
            )}

            {status === 'aprovado_diretor' && (meuPapel === 'financeiro' || meuPapel === 'admin') && (
                <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                    <button
                        disabled={acao}
                        onClick={() => rodar(() => iniciarAnaliseFinanceira(id))}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black hover:bg-primary-light disabled:opacity-50"
                    >
                        Iniciar Análise Financeira
                    </button>
                </div>
            )}

            {status === 'em_analise_financeiro' && (meuPapel === 'financeiro' || meuPapel === 'admin') && (
                <DecisaoBox titulo="Análise Financeira (condição de pagamento)" onDecidir={(d, m) => rodar(() => decidirFinanceiro(id, d, m))} />
            )}

            {podeReenviarFinanceiro && (
                <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                    <button
                        disabled={acao}
                        onClick={() => rodar(() => reenviarFinanceiro(id))}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black hover:bg-primary-light disabled:opacity-50"
                    >
                        Reenviar ao Financeiro
                    </button>
                </div>
            )}

            {podeCancelar && (
                <button
                    disabled={acao}
                    onClick={() => rodar(() => cancelarRequisicao(id, 'Cancelado pelo solicitante.'))}
                    className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-400 hover:text-danger"
                >
                    <Ban className="h-3.5 w-3.5" /> Cancelar requisição
                </button>
            )}

            {/* Anexos */}
            <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                    <Paperclip className="h-4 w-4" /> Anexos (proposta comercial, etc.)
                </h2>
                <div className="space-y-1">
                    {(dados.anexos || []).map(a => (
                        <button key={a.id} onClick={() => handleAbrirAnexo(a.id)} className="block text-xs font-medium text-primary-dark underline">
                            {a.file_name}
                        </button>
                    ))}
                    {(dados.anexos || []).length === 0 && <p className="text-xs text-neutral-400">Nenhum anexo ainda.</p>}
                </div>
                <div className="flex gap-2">
                    <input type="file" onChange={e => setArquivo(e.target.files?.[0] || null)} className="flex-1 text-xs" />
                    <button
                        disabled={!arquivo || acao}
                        onClick={handleUpload}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-bold text-neutral-700 hover:border-primary hover:text-primary disabled:opacity-40"
                    >
                        <Upload className="h-3.5 w-3.5" /> Enviar
                    </button>
                </div>
            </section>

            {/* Histórico / comentários */}
            <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <h2 className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                    <MessageSquare className="h-4 w-4" /> Histórico
                </h2>
                <div className="space-y-2">
                    {(dados.comentarios || []).map(c => (
                        <div key={c.id} className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-xs">
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-neutral-700">{ACTION_LABELS[c.action] || c.action || 'Comentário'}</span>
                                <span className="text-neutral-400">{new Date(c.created_at).toLocaleString('pt-BR')}</span>
                            </div>
                            {c.comment && <p className="mt-1 text-neutral-600">{c.comment}</p>}
                        </div>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input
                        className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary"
                        placeholder="Adicionar comentário..."
                        value={novoComentario}
                        onChange={e => setNovoComentario(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleComentar()}
                    />
                    <button
                        disabled={!novoComentario.trim() || acao}
                        onClick={handleComentar}
                        className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-black hover:bg-primary-light disabled:opacity-40"
                    >
                        Comentar
                    </button>
                </div>
            </section>
        </div>
    );
}
