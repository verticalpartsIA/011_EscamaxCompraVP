import React, { useState, useEffect } from 'react';
import { Search, Package, LogOut, BarChart2, PackageX, Boxes, MapPin, ChevronsUpDown, Store, ClipboardCheck, UserPlus, ScrollText, Warehouse } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function contarDemandas() {
    try { return JSON.parse(localStorage.getItem('escamax_demandas') || '[]').length; }
    catch { return 0; }
}

const NAV_BASE = [
    { to: '/', icon: Search, label: 'Consultar Peças' },
    { to: '/produtos-vp', icon: Boxes, label: 'Produtos VerticalParts' },
    { to: '/outros-fornecedores', icon: Store, label: 'Outros Fornecedores' },
    { to: '/aprovacoes', icon: ClipboardCheck, label: 'Aprovações' },
    { to: '/history', icon: Package, label: 'Histórico de Pedidos' },
    { to: '/sem-estoque', icon: PackageX, label: 'Peças Sem Estoque', badge: true },
    { to: '/estoque-vp', icon: Warehouse, label: 'Estoque VerticalParts' },
    { to: '/estoque-escamax', icon: Warehouse, labelFn: filial => `Estoque Escamax ${filial?.label || ''}` },
    { to: '/dashboard', icon: BarChart2, label: 'Dashboard' },
];

const NAV_ADMIN = [
    { to: '/logs', icon: ScrollText, label: 'Logs' },
    { to: '/usuarios/convidar', icon: UserPlus, label: 'Convidar Usuário' },
];

export default function Sidebar({ logout }) {
    const { filial, user } = useAuth();
    const navigate = useNavigate();
    const [totalDemandas, setTotalDemandas] = useState(contarDemandas);

    useEffect(() => {
        const handler = () => setTotalDemandas(contarDemandas());
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    const nav = user?.admin ? [...NAV_BASE, ...NAV_ADMIN] : NAV_BASE;

    return (
        <aside className="dark-scroll flex h-full w-[220px] flex-col overflow-y-auto bg-surface border-r border-surface-border">
            {/* Logo */}
            <div className="flex items-center border-b border-surface-border px-4 py-5">
                <img src="/logo-white.png" alt="VerticalParts" className="h-7 object-contain" />
            </div>

            {/* Navegação */}
            <nav className="flex-1 space-y-0.5 p-2 pt-3">
                {nav.map(({ to, icon: Icon, label, labelFn, badge }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={to === '/'}
                        className={({ isActive }) =>
                            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                                isActive
                                    ? 'bg-primary/15 text-primary'
                                    : 'text-slate-400 hover:bg-surface-card hover:text-white'
                            }`
                        }
                    >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate flex-1">{labelFn ? labelFn(filial) : label}</span>
                        {badge && totalDemandas > 0 && (
                            <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-black leading-none text-black">
                                {totalDemandas}
                            </span>
                        )}
                    </NavLink>
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

            {/* Rodapé: logout */}
            <div className="border-t border-surface-border p-3">
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
