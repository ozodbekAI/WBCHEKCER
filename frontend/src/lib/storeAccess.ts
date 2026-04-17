import type { Store, StoreWbFeatureAccess, StoreWbTokenAccess } from '../types';

export type StoreFeatureKey = 'cards' | 'photo_studio' | 'ab_tests' | 'ad_analysis';

export function getStoreFeatureAccess(
  store: Store | null | undefined,
  featureKey: StoreFeatureKey,
): StoreWbFeatureAccess | null {
  if (!store?.wb_token_access?.features) return null;
  return store.wb_token_access.features[featureKey] || null;
}

export function isStoreFeatureAllowed(
  store: Store | null | undefined,
  featureKey: StoreFeatureKey,
): boolean {
  const access = getStoreFeatureAccess(store, featureKey);
  if (!access) return true; // if no access info, allow by default
  return access.allowed;
}

export function getStoreFeatureMessage(
  store: Store | null | undefined,
  featureKey: StoreFeatureKey,
): string {
  const access = getStoreFeatureAccess(store, featureKey);
  if (!access) return '';
  return access.message || `Функция "${access.label}" недоступна`;
}

export function getDeniedStoreFeatures(
  tokenAccess: StoreWbTokenAccess | null | undefined,
): Array<{ key: string; label: string; message: string; recommended_slot_labels: string[] }> {
  if (!tokenAccess?.features) return [];
  return Object.entries(tokenAccess.features)
    .filter(([, v]) => !v.allowed)
    .map(([k, v]) => ({ key: k, label: v.label, message: v.message, recommended_slot_labels: v.recommended_slot_labels || [] }));
}
