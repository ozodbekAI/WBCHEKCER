import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LockKeyhole, RefreshCcw } from 'lucide-react';

import { Button } from './ui/button';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import type { StoreFeatureKey } from '../lib/storeAccess';
import { getStoreFeatureAccess, getStoreFeatureMessage } from '../lib/storeAccess';
import StoreKeyUpdateDialog from './StoreKeyUpdateDialog';

interface StoreFeatureBlockedStateProps {
  featureKey: StoreFeatureKey;
  fallbackPath?: string;
  title?: string;
}

export default function StoreFeatureBlockedState({
  featureKey,
  fallbackPath = '/workspace',
  title,
}: StoreFeatureBlockedStateProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeStore } = useStore();
  const { isRole } = useAuth();
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const access = getStoreFeatureAccess(activeStore, featureKey);
  const featureLabel = title || access?.label || 'разделу';
  const canUpdateKey = isRole('owner', 'admin');

  useEffect(() => {
    if ((location.state as { openKeyDialog?: boolean } | null)?.openKeyDialog && canUpdateKey && activeStore) {
      setShowKeyDialog(true);
    }
  }, [activeStore, canUpdateKey, location.state]);

  return (
    <>
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="w-full max-w-xl rounded-3xl border border-border bg-card p-8 shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <LockKeyhole size={24} />
          </div>

          <div className="text-center">
            <h1 className="text-2xl font-semibold text-foreground">
              {featureLabel} сейчас недоступен
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {getStoreFeatureMessage(activeStore, featureKey)}
            </p>

            {!!activeStore && (
              <div className="mt-4 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-left text-sm text-muted-foreground">
                <div className="font-medium text-foreground">{activeStore.name}</div>
                <div className="mt-1">
                  Текущие категории ключа: {(activeStore.wb_token_access?.category_labels || []).join(', ') || 'не определены'}
                </div>
                {access?.required_categories_labels?.length ? (
                  <div className="mt-1">
                    Для этого раздела нужны: {access.required_categories_labels.join(', ')}
                  </div>
                ) : null}
                {access?.recommended_slot_labels?.length ? (
                  <div className="mt-1">
                    Можно добавить отдельный ключ: {access.recommended_slot_labels.join(', ')}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button onClick={() => navigate(fallbackPath)}>
              Вернуться в рабочее пространство
            </Button>
            {canUpdateKey && activeStore ? (
              <Button variant="outline" onClick={() => setShowKeyDialog(true)}>
                <RefreshCcw size={14} className="mr-2" />
                Открыть настройки ключей
              </Button>
            ) : (
              <Button variant="outline" onClick={() => navigate('/onboard')}>
                <RefreshCcw size={14} className="mr-2" />
                Подключить другой магазин
              </Button>
            )}
          </div>
        </div>
      </div>

      <StoreKeyUpdateDialog
        open={showKeyDialog}
        onOpenChange={setShowKeyDialog}
        store={activeStore}
        featureKey={featureKey}
        featureLabel={featureLabel}
      />
    </>
  );
}
