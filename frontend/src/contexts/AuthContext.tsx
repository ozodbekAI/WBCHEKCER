import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  registerStart: (email: string, password: string, firstName?: string, lastName?: string) => Promise<{ message: string; cooldown_seconds: number; expires_in_seconds: number }>;
  resendRegisterCode: (email: string) => Promise<{ message: string; cooldown_seconds: number; expires_in_seconds: number }>;
  verifyRegisterCode: (email: string, code: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
  isRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    const token = api.getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const me = await api.getMe();
      setUser(me);
    } catch {
      api.logout();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string) => {
    const data = await api.login(email, password);
    setUser(data.user);
  };

  const registerStart = async (email: string, password: string, firstName?: string, lastName?: string) => {
    return api.registerStart(email, password, firstName, lastName);
  };

  const resendRegisterCode = async (email: string) => {
    return api.resendRegisterCode(email);
  };

  const verifyRegisterCode = async (email: string, code: string) => {
    const data = await api.verifyRegisterCode(email, code);
    setUser(data.user);
  };

  const logout = () => {
    api.logout();
    setUser(null);
  };

  const refreshUser = useCallback(async () => {
    const me = await api.getMe();
    setUser(me);
  }, []);

  const hasPermission = useCallback((permission: string): boolean => {
    if (!user) return false;
    const perms = user.permissions || [];
    return perms.includes(permission) || perms.includes('*');
  }, [user]);

  const hasAnyPermission = useCallback((...permissions: string[]): boolean => {
    return permissions.some(p => hasPermission(p));
  }, [hasPermission]);

  const isRole = useCallback((...roles: string[]): boolean => {
    if (!user) return false;
    return roles.includes(user.role);
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        registerStart,
        resendRegisterCode,
        verifyRegisterCode,
        logout,
        refreshUser,
        isAuthenticated: !!user,
        hasPermission,
        hasAnyPermission,
        isRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
