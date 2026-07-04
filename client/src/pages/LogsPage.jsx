import React, { useState, useEffect, useCallback } from 'react';
import { ScrollText, MessageSquare, Send, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '';
// Quem pode abrir indagações: aprovador da alçada máxima (nível 3), vindo do perfil.
const NIVEL_ALCADA_INDAGADOR = 3;

const ACAO_LABEL = {
    'login.sucesso': 'Login realizado',
    'login.falhou': 'Login falhou',
    'login.negado': 'Login negado (sem perfil)',
    'pedido.criado': 'Pedido criado',
    'pedido.alcada_aprovada': 'Alçada aprovada',
    'pedido.reprovado': 'Pedido reprovado',
    'pedido.entrega_confirmada_manual': 'Entrega confirmada (manual)',
    'usuario.convidado': 'Usuário convidado',
};

function formatDateBR(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('pt-BR');
}

function ObservacaoThread({ log, emailAtual, alcadaNivel }) {
    const token = localStorage.getItem('token');
    const [observacoes, setObservacoes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [mensagem, setMensagem] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [erro, setErro] = useState('');

    const carregar = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/logs/${log.id}/observacoes`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) setObservacoes(await res.json());
        } finally {
            setLoading(false);
        }
    }, [log.id, token]);

    useEffect(() => { carregar(); }, [carregar]);

    const podeIniciar = Number(alcadaNivel) === NIVEL_ALCADA_INDAGADOR;
    const jaParticipou = observacoes.some(o => o.autor_email === emailAtual);
    const podeEscrever = observacoes.length === 0 ? podeIniciar : (podeIniciar || jaParticipou);

    const enviar = async () => {
        if (!mensagem.trim()) return;
        setEnviando(true);
        setErro('');
        try {
            const res = await fetch(`${API_BASE}/api/logs/${log.id}/observacoes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ mensagem }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao enviar.');
            setMensagem('');
            await carregar();
        } catch (e) {
            setErro(e.message);
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="mt-3 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                <MessageSquare className="h-3.5 w-3.5" /> Observações
            </p>
            {loading ? (
                <p className="text-xs text-neutral-400">Carregando...</p>
            ) : observacoes.length === 0 ? (
                <p className="text-xs text-neutral-400">Nenhuma observação ainda.</p>
            ) : (
                <div className="space-y-1.5">
                    {observacoes.map(o => (
                        <div key={o.id} className="rounded border border-neutral-200 bg-white px-3 py-1.5 text-xs">
                            <span className="font-bold text-neutral-700">{o.autor_email}</span>
                            <span className="ml-2 text-neutral-400">{formatDateBR(o.criado_em)}</span>
                            <p className="mt-0.5 text-neutral-700">{o.mensagem}</p>
                        </div>
                    ))}
                </div>
            )}

            {podeEscrever ? (
                <div className="flex gap-2">
                    <input
                        value={mensagem}
                        onChange={e => setMensagem(e.target.value)}
                        placeholder={observacoes.length === 0 ? 'Indagar sobre esta decisão...' : 'Responder...'}
                        className="flex-1 rounded border border-neutral-200 px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <button
                        onClick={enviar}
                        disabled={enviando || !mensagem.trim()}
                        className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50"
                    >
                        {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    </button>
                </div>
            ) : (
                <p className="text-[11px] text-neutral-400">
                    Só o aprovador da alçada máxima pode abrir uma indagação; quem participa da conversa pode responder.
                </p>
            )}
            {erro && <p className="text-[11px] font-semibold text-danger">{erro}</p>}
        </div>
    );
}

export default function LogsPage() {
    const { user } = useAuth();
    const token = localStorage.getItem('token');
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandido, setExpandido] = useState(null);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const res = await fetch(`${API_BASE}/api/logs`, { headers: { Authorization: `Bearer ${token}` } });
                if (res.ok) setLogs(await res.json());
            } finally {
                setLoading(false);
            }
        })();
    }, [token]);

    return (
        <div className="mx-auto max-w-4xl space-y-5">
            <div>
                <p className="vp-eyebrow">Governança B2B</p>
                <h1 className="font-display text-2xl font-bold text-black flex items-center gap-2">
                    <ScrollText className="h-6 w-6 text-primary-dark" />
                    Logs de Auditoria
                </h1>
                <p className="mt-1 text-sm text-neutral-500">
                    Registro de todas as ações dos usuários no portal.
                </p>
            </div>

            {loading ? (
                <div className="space-y-2">
                    {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-xl bg-white border border-neutral-200 animate-pulse" />)}
                </div>
            ) : logs.length === 0 ? (
                <div className="rounded-xl border border-neutral-200 bg-white p-12 text-center text-neutral-400">
                    Nenhum log registrado ainda.
                </div>
            ) : (
                <div className="space-y-2">
                    {logs.map(log => {
                        const aberto = expandido === log.id;
                        return (
                            <div key={log.id} className="rounded-xl border border-neutral-200 bg-white shadow-card">
                                <button
                                    onClick={() => setExpandido(aberto ? null : log.id)}
                                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                                >
                                    <div>
                                        <p className="text-sm font-bold text-black">
                                            {ACAO_LABEL[log.acao] || log.acao}
                                        </p>
                                        <p className="text-xs text-neutral-500">
                                            {log.usuario_email} · {formatDateBR(log.criado_em)}
                                            {log.pedido_id && ` · Pedido ${log.pedido_id}`}
                                        </p>
                                    </div>
                                    {aberto ? <ChevronUp className="h-4 w-4 text-neutral-400" /> : <ChevronDown className="h-4 w-4 text-neutral-400" />}
                                </button>
                                {aberto && (
                                    <div className="border-t border-neutral-100 px-4 pb-4 pt-2">
                                        {log.detalhes && (
                                            <pre className="mb-2 overflow-x-auto rounded bg-neutral-50 p-2 text-[11px] text-neutral-600">
                                                {JSON.stringify(log.detalhes, null, 2)}
                                            </pre>
                                        )}
                                        <ObservacaoThread log={log} emailAtual={user?.email} alcadaNivel={user?.alcadaNivel} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
