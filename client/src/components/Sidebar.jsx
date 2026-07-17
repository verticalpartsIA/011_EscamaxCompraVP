import React, { useState, useEffect } from 'react';
import { Package, LogOut, BarChart2, PackageX, Boxes, MapPin, ChevronsUpDown, Store, ClipboardCheck, UserPlus, ScrollText, Warehouse, Wrench, ListChecks, BookOpen } from 'lucide-react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function contarDemandas() {
    try { return JSON.parse(localStorage.getItem('escamax_demandas') || '[]').length; }
    catch { return 0; }
}

// Navegação agrupada por domínio. Itens com `admin: true` só aparecem para
// administradores; uma seção cujos itens são todos admin some por inteiro
// para usuários comuns. O catálogo de preços (LPU) fica junto do módulo de
// Serviços a que pertence, não solto no fim da lista.
const NAV_SECTIONS = [
    {
        title: 'Peças',
        items: [
            { to: '/produtos-vp', icon: Boxes, label: 'Produtos VerticalParts' },
            { to: '/outros-fornecedores', icon: Store, label: 'Outros Fornecedores' },
            { to: '/sem-estoque', icon: PackageX, label: 'Peças Sem Estoque', badge: true },
        ],
    },
    {
        title: 'Estoque',
        items: [
            { to: '/estoque-vp', icon: Warehouse, label: 'Estoque VerticalParts' },
            { to: '/estoque-escamax', icon: Warehouse, labelFn: filial => `Estoque Escamax ${filial?.label || ''}` },
        ],
    },
    {
        title: 'Pedidos',
        items: [
            { to: '/aprovacoes', icon: ClipboardCheck, label: 'Aprovações' },
            { to: '/history', icon: Package, label: 'Histórico de Pedidos' },
            { to: '/dashboard', icon: BarChart2, label: 'Dashboard' },
        ],
    },
    {
        title: 'Serviços',
        items: [
            // matchExclude: fica ativo na lista/detalhe/nova requisição, mas
            // não quando a sub-rota /lpu (item irmão) está aberta.
            { to: '/requisicao-servicos', icon: Wrench, label: 'Requisição Serviços', matchExclude: ['/requisicao-servicos/lpu'] },
            { to: '/requisicao-servicos/lpu', icon: ListChecks, label: 'Tabela de Preços (LPU) — Admin', admin: true },
        ],
    },
    {
        title: 'Administração',
        items: [
            { to: '/usuarios/convidar', icon: UserPlus, label: 'Convidar Usuário', admin: true },
            { to: '/logs', icon: ScrollText, label: 'Logs', admin: true },
        ],
    },
];

// Rota ativa calculada à mão (em vez do isActive do NavLink) para lidar com o
// caso de rotas irmãs que compartilham prefixo: /requisicao-servicos precisa
// ficar ativo em /nova e /:id, mas NÃO em /requisicao-servicos/lpu (que é um
// item de menu próprio). matchExclude cobre esse caso pontual.
function rotaAtiva(item, pathname) {
    if (item.to === '/') return pathname === '/';
    const dentro = pathname === item.to || pathname.startsWith(`${item.to}/`);
    if (!dentro) return false;
    if (item.matchExclude) {
        return !item.matchExclude.some(ex => pathname === ex || pathname.startsWith(`${ex}/`));
    }
    return true;
}

export default function Sidebar({ logout }) {
    const { filial, user } = useAuth();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const [totalDemandas, setTotalDemandas] = useState(contarDemandas);

    useEffect(() => {
        const handler = () => setTotalDemandas(contarDemandas());
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    const isAdmin = Boolean(user?.admin);
    const sections = NAV_SECTIONS
        .map(section => ({ ...section, items: section.items.filter(item => !item.admin || isAdmin) }))
        .filter(section => section.items.length > 0);

    return (
        <aside className="dark-scroll flex h-full w-[220px] flex-col overflow-y-auto bg-surface border-r border-surface-border">
            {/* Logo */}
            <div className="flex items-center border-b border-surface-border px-4 py-5">
                <img src="/logo-white.png" alt="VerticalParts" className="h-7 object-contain" />
            </div>

            {/* Navegação agrupada por seção */}
            <nav className="flex-1 p-2 pt-3">
                {sections.map((section, i) => (
                    <div key={section.title} className={`space-y-0.5 ${i === 0 ? '' : 'mt-4'}`}>
                        <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                            {section.title}
                        </p>
                        {section.items.map((item) => {
                            const { to, icon: Icon, label, labelFn, badge } = item;
                            const ativo = rotaAtiva(item, pathname);
                            return (
                            <NavLink
                                key={to}
                                to={to}
                                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                                    ativo
                                        ? 'bg-primary/15 text-primary'
                                        : 'text-slate-400 hover:bg-surface-card hover:text-white'
                                }`}
                            >
                                <Icon className="h-4 w-4 shrink-0" />
                                <span className="truncate flex-1">{labelFn ? labelFn(filial) : label}</span>
                                {badge && totalDemandas > 0 && (
                                    <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-black leading-none text-black">
                                        {totalDemandas}
                                    </span>
                                )}
                            </NavLink>
                            );
                        })}
                    </div>
                ))}
            </nav>

            {/* Filial ativa */}
            {filial && (
                <div className="px-3 pb-1">
                    <button
                        onClick={() => navigate('/selecionar-filial')}
                        className="flex w-full items-center gap-2.5 rounded-lg border border-surface-border bg-surface-card px-3 py-2.5 text-left transition-all hover:border-primary/50 group"
                        title="Trocar filial"
                    >
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">Filial ativa</p>
                            <p className="text-xs font-bold text-white truncate">{filial.label}</p>
                        </div>
                        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-neutral-600 group-hover:text-primary transition-colors" />
                    </button>
                </div>
            )}

            {/* Rodapé: tutorial + logout */}
            <div className="border-t border-surface-border p-3 space-y-0.5">
                <a
                    href="/tutorial.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-surface-card hover:text-primary"
                >
                    <BookOpen className="h-3.5 w-3.5 shrink-0" />
                    Saiba como Usar
                </a>
                <button
                    onClick={logout}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-surface-card hover:text-red-400"
                >
                    <LogOut className="h-3.5 w-3.5 shrink-0" />
                    Sair
                </button>
            </div>
        </aside>
    );
}
