import type { Store, StoreWbFeatureAccess } from '../types';

export type StoreFeatureKey =
  | 'cards'
  | 'cards_write'
  | 'photo_studio'
  | 'ab_tests'
  | 'ad_analysis'
  | 'documents';

export function getStoreFeatureAccess(
  store: Store | null | undefined,
  featureKey: StoreFeatureKey,
): StoreWbFeatureAccess | null {
  if (!store) return null;
  return store.wb_token_access?.features?.[featureKey] || null;
}

export function isStoreFeatureAllowed(
  store: Store | null | undefined,
  featureKey: StoreFeatureKey,
): boolean {
  const access = getStoreFeatureAccess(store, featureKey);
  if (!access) return true;
  return !!access.allowed;
}

export function getStoreFeatureMessage(
  store: Store | null | undefined,
  featureKey: StoreFeatureKey,
): string {
  const access = getStoreFeatureAccess(store, featureKey);
  if (access?.message) return access.message;
  return 'У вашего текущего WB-ключа нет доступа к этому разделу. Обновите ключ или подключите отдельный ключ для этого раздела.';
}

export function getDeniedStoreFeatures(
  access: Store['wb_token_access'] | null | undefined,
): StoreWbFeatureAccess[] {
  const features = access?.features || {};
  return Object.values(features).filter((feature) => !feature.allowed);
}
