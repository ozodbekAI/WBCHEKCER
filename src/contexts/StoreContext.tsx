import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';
import type { Store } from '../types';

interface StoreContextType {
  stores: Store[];
  activeStore: Store | null;
  loading: boolean;
  storesReady: boolean;
  loadStores: () => Promise<void>;
  setActiveStore: (store: Store | null) => void;
  selectStore: (storeId: number) => void;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStore, setActiveStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);
  const [storesReady, setStoresReady] = useState(false);
  const loadedOnce = useRef(false);

  const loadStores = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getStores();
      setStores(data);
      if (data.length > 0 && !activeStore) {
        setActiveStore(data[0]);
      }
    } catch (e) {
      console.error('Failed to load stores:', e);
    } finally {
      setLoading(false);
      setStoresReady(true);
    }
  }, [activeStore]);

  // Auto-load stores once auth is ready and user is authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated && !loadedOnce.current) {
      loadedOnce.current = true;
      loadStores();
    }
    // Reset when user logs out so stores reload on next login
    if (!isAuthenticated && !authLoading) {
      loadedOnce.current = false;
      setStoresReady(false);
    }
  }, [isAuthenticated, authLoading, loadStores]);

  const selectStore = useCallback((storeId: number) => {
    const store = stores.find(s => s.id === storeId);
    if (store) setActiveStore(store);
  }, [stores]);

  return (
    <StoreContext.Provider
      value={{ stores, activeStore, loading, storesReady, loadStores, setActiveStore, selectStore }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
