import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [filial, setFilialState] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem('token');
        const savedUser = localStorage.getItem('escamax_user');
        const savedFilial = localStorage.getItem('escamax_filial');

        if (token && savedUser) {
            try {
                setUser(JSON.parse(savedUser));
                setIsAuthenticated(true);
            } catch {
                localStorage.removeItem('token');
                localStorage.removeItem('escamax_user');
            }
        }
        if (savedFilial) {
            try { setFilialState(JSON.parse(savedFilial)); } catch { /* ignorar */ }
        }
        setLoading(false);
    }, []);

    const login = async (email, senha) => {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, senha })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'E-mail ou senha inválidos.');

        localStorage.setItem('token', data.token);
        localStorage.setItem('escamax_user', JSON.stringify(data.user));
        setUser(data.user);
        setIsAuthenticated(true);
        return true;
    };

    const selectFilial = (filialObj) => {
        setFilialState(filialObj);
        localStorage.setItem('escamax_filial', JSON.stringify(filialObj));
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('escamax_user');
        localStorage.removeItem('escamax_filial');
        setUser(null);
        setFilialState(null);
        setIsAuthenticated(false);
    };

    const value = { user, filial, isAuthenticated, login, selectFilial, logout, loading };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
}
