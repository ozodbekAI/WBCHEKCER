export type WizardStep =
  | 'connection'
  | 'import'
  | 'mode'
  | 'ratings'
  | 'tone'
  | 'brands'
  | 'responseStyle'
  | 'complete'

/**
 * Left for backward compatibility (ModeStep is no longer used in the onboarding flow).
 */
export type AutomationMode = 'manual' | 'control' | 'autopilot'

/**
 * Per-rating workflow:
 * - manual: do nothing automatically
 * - semi: generate draft (requires manual publish)
 * - auto: auto-publish (only when automation_enabled=true)
 */
export type RatingMode = 'manual' | 'semi' | 'auto'

export type SignatureType = 'all' | 'review' | 'question' | 'chat'

export interface SignatureItem {
  text: string
  type: SignatureType
  brand: string // 'all' or конкретный бренд
  is_active?: boolean
}

export interface ResponseStyleConfig {
  addressForm: 'formal-you' | 'informal-you' | 'ty'
  useCustomerName: boolean
  useEmoji: boolean
  responseLength: 'short' | 'default' | 'long'
}
