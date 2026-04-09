import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';
import type { Store } from '../types';
import { isStoreFeatureAllowed } from '../lib/storeAccess';
import { toast } from 'sonner';

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
const ACTIVE_STORE_KEY = 'avemod_active_store_id';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStore, setActiveStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);
  const [storesReady, setStoresReady] = useState(false);
  const loadedOnce = useRef(false);
  const adAnalysisBootstrapStartedForStore = useRef<number | null>(null);

  const loadStores = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getStores();
      setStores(data);
      const storedId = Number(localStorage.getItem(ACTIVE_STORE_KEY) || 0);
      const preferred = data.find(s => s.id === storedId);
      if (preferred) {
        setActiveStore(preferred);
      } else if (activeStore) {
        const refreshed = data.find(s => s.id === activeStore.id);
        setActiveStore(refreshed || data[0] || null);
      } else if (data.length > 0) {
        setActiveStore(data[0]);
      }
    } catch (e) {
      console.error('Failed to load stores:', e);
      toast.error('Не удалось загрузить список магазинов');
    } finally {
      setLoading(false);
      setStoresReady(true);
    }
  }, [activeStore]);

  useEffect(() => {
    if (activeStore) {
      localStorage.setItem(ACTIVE_STORE_KEY, String(activeStore.id));
    } else {
      localStorage.removeItem(ACTIVE_STORE_KEY);
    }
  }, [activeStore]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && !loadedOnce.current) {
      loadedOnce.current = true;
      loadStores();
    }
    if (!isAuthenticated && !authLoading) {
      loadedOnce.current = false;
      setStoresReady(false);
    }
  }, [isAuthenticated, authLoading, loadStores]);

  useEffect(() => {
    if (!activeStore) return;
    if (!isStoreFeatureAllowed(activeStore, 'ad_analysis')) return;
    if (adAnalysisBootstrapStartedForStore.current === activeStore.id) return;

    adAnalysisBootstrapStartedForStore.current = activeStore.id;
    void api.startAdAnalysisBootstrap(activeStore.id).catch(() => {
      // Ad analysis warms up in the background; route gate will surface errors if needed.
    });
  }, [activeStore?.id, activeStore?.wb_token_access]);

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
