// ==================== User ====================
export interface User {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url?: string | null;
  role: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  last_login: string | null;
  permissions: string[];
}

export type UserRole = 'admin' | 'owner' | 'head_manager' | 'manager' | 'viewer' | 'user';

export interface TeamMember {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  custom_permissions: string[] | null;
  permissions: string[];
  fixes_total: number;
  fixes_today: number;
  approvals_pending: number;
  approvals_approved: number;
}

export interface PermissionInfo {
  id: string;
  label: string;
  group: string;
}

export interface PermissionsListOut {
  permissions: PermissionInfo[];
  groups: Record<string, string[]>;
}

export interface TeamActivityMember {
  id: number;
  name: string;
  role: string;
  fixes_week: number;
  fixes_today: number;
  last_login: string | null;
  last_active_at: string | null;
  is_online: boolean;
}

export interface TeamActivity {
  members: TeamActivityMember[];
  pending_approvals: number;
  issues_summary: Record<string, number>;
  total_members: number;
}

export interface TeamTicket {
  id: number;
  type: 'delegation' | 'approval';
  status: 'pending' | 'done';
  store_id: number;
  issue_id?: number | null;
  approval_id?: number | null;
  card_id?: number | null;
  issue_title?: string | null;
  issue_severity?: string | null;
  issue_code?: string | null;
  card_title?: string | null;
  card_photo?: string | null;
  card_nm_id?: number | null;
  card_vendor_code?: string | null;
  from_user_id?: number | null;
  from_user_name?: string | null;
  to_user_id?: number | null;
  to_user_name?: string | null;
  note?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  user_count: number;
}

export interface CardApproval {
  id: number;
  store_id: number;
  card_id: number;
  prepared_by_id: number;
  reviewed_by_id: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  changes: ApprovalChange[];
  total_fixes: number;
  submit_note: string | null;
  reviewer_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
  applied_at: string | null;
  prepared_by_name: string | null;
  reviewed_by_name: string | null;
  card_title: string | null;
  card_nm_id: number | null;
  card_vendor_code: string | null;
  card_photo: string | null;
}

export interface ApprovalChange {
  issue_id: number;
  field_path: string | null;
  title: string;
  old_value: string | null;
  new_value: string | null;
  severity: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export type AsyncTaskStatus =
  | 'pending'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ==================== Store ====================
export interface Store {
  id: number;
  name: string;
  status: string;
  status_message: string | null;
  wb_supplier_id: string | null;
  wb_supplier_name: string | null;
  total_cards: number;
  critical_issues: number;
  warnings_count: number;
  growth_potential: number;
  last_sync_at: string | null;
  last_analysis_at: string | null;
  created_at: string;
  wb_token_access: StoreWbTokenAccess;
}

export interface StoreWbFeatureAccess {
  label: string;
  allowed: boolean;
  reason: string | null;
  message: string;
  required_categories: string[];
  required_categories_labels: string[];
  missing_categories: string[];
  missing_categories_labels: string[];
  requires_write: boolean;
  source_slot: string | null;
  source_label: string | null;
  using_specific_key: boolean;
  recommended_slots: string[];
  recommended_slot_labels: string[];
}

export interface StoreWbTokenSnapshot {
  decoded: boolean;
  decode_error: string | null;
  token_type: string | null;
  scope_mask: number | null;
  categories: string[];
  category_labels: string[];
  read_only: boolean;
  expires_at: string | null;
}

export interface StoreWbKeySlot {
  slot_key: string;
  label: string;
  configured: boolean;
  is_default: boolean;
  feature_keys: string[];
  feature_labels: string[];
  token_access: StoreWbTokenSnapshot;
  updated_at: string | null;
}

export interface StoreWbTokenAccess {
  decoded: boolean;
  decode_error: string | null;
  token_type: string | null;
  scope_mask: number | null;
  categories: string[];
  category_labels: string[];
  read_only: boolean;
  expires_at: string | null;
  features: Record<string, StoreWbFeatureAccess>;
  key_slots: StoreWbKeySlot[];
}

export interface StoreStats {
  total_cards: number;
  critical_issues: number;
  warnings_count: number;
  improvements_count: number;
  growth_potential: number;
  average_score: number;
  issues_by_severity: Record<string, number>;
  issues_by_category: Record<string, number>;
}

export interface OnboardResult {
  store_id: number;
  store_name: string;
  supplier_name: string | null;
  supplier_id: string | null;
  cards_synced: number;
  cards_new: number;
  cards_analyzed: number;
  issues_found: number;
  ai_enabled: boolean;
  wb_token_access: StoreWbTokenAccess | null;
}

export interface OnboardStartResponse {
  task_id: string;
  status: string;
}

export interface OnboardingTaskStatus {
  task_id: string;
  status: AsyncTaskStatus;
  step: string;
  progress: number;
  store_id: number | null;
  result: OnboardResult | null;
  error: string | null;
  created_at: string | null;
  completed_at: string | null;
}

// ==================== Card ====================
export interface Card {
  id: number;
  store_id: number;
  nm_id: number;
  vendor_code: string | null;
  title: string | null;
  brand: string | null;
  main_photo_url?: string | null;
  photos?: string[];
  description: string | null;
  subject_name: string | null;
  category_name: string | null;
  photos_count: number;
  videos_count: number;
  price: number | null;
  discount: number | null;
  score: number | null;
  score_breakdown: Record<string, any> | null;
  critical_issues_count: number | null;
  warnings_count: number | null;
  improvements_count: number | null;
  growth_points_count: number | null;
  confirmation_summary?: CardConfirmationSummary | null;
  last_analysis_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CardDetail extends Card {
  imt_id: number | null;
  photos: string[];
  videos: string[];
  characteristics: Record<string, any>;
  dimensions: Record<string, any>;
  raw_data: Record<string, any>;
  issues: Issue[];
}

export interface DescriptionEditorDraftPayload {
  title?: string | null;
  description?: string | null;
  characteristics?: Record<string, any>;
}

export interface DescriptionEditorContext {
  field: 'description';
  keywords: string[];
}

export interface DescriptionEditorGenerateResult extends DescriptionEditorContext {
  value: string;
  reason: string | null;
}

export interface CardListResponse {
  items: Card[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ==================== Issue ====================
export interface Issue {
  id: number;
  card_id: number;
  code: string;
  severity: 'critical' | 'warning' | 'improvement' | 'info';
  category: string;
  title: string;
  description: string | null;
  current_value: string | null;
  field_path: string | null;
  suggested_value: string | null;
  alternatives: string[];
  charc_id: number | null;
  allowed_values: any[];
  max_count: number | null;
  error_details: any[];
  ai_suggested_value: string | null;
  ai_reason: string | null;
  ai_alternatives: string[];
  source: string | null;
  score_impact: number;
  status: string;
  fixed_value: string | null;
  fixed_at: string | null;
  created_at: string;
}

export interface IssueWithCard extends Issue {
  card_nm_id: number;
  card_title: string | null;
  card_vendor_code: string | null;
  card_photos: string[];
  card_pending_count: number;
  requires_fixed_file: boolean;
}

export interface IssuesGrouped {
  critical: IssueWithCard[];
  warnings: IssueWithCard[];
  improvements: IssueWithCard[];
  media: IssueWithCard[];
  postponed: IssueWithCard[];
  critical_count: number;
  warnings_count: number;
  improvements_count: number;
  media_count: number;
  postponed_count: number;
}

export interface QueueProgress {
  total: number;
  pending: number;
  fixed: number;
  skipped: number;
  postponed: number;
  progress_percent: number;
}

// ==================== Dashboard ====================
export interface TaskCategory {
  name: string;
  description: string;
  issues_count: number;
  cards_count: number;
  problems_count: number;
  color: string;
  action_label: string;
}

export interface WorkspaceDashboard {
  store_name: string;
  critical: TaskCategory;
  incoming: TaskCategory;
  by_cards: TaskCategory;
  potential_revenue: string;
  fixed_today: number;
  active_tests: number;
  recent_activity: any[];
}

export interface DashboardStats {
  total_cards: number;
  average_score: number;
  critical_issues: number;
  warnings: number;
  improvements: number;
  fixed_today: number;
  growth_potential: string;
  potential_revenue: string;
  recent_activity: any[];
}

// ─── Fixed File ───────────────────────────────────────────────────────────────

export interface FixedFileEntry {
  id: number;
  store_id: number;
  nm_id: number;
  brand: string | null;
  subject_name: string | null;
  char_name: string;
  fixed_value: string;
  created_at: string;
  updated_at: string;
}

export interface FixedEntryListOut {
  items: FixedFileEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface FixedFileMismatch {
  char_name: string;
  card_value: string | null;
  fixed_value: string;
  field_path: string;
}

export interface RecheckResult {
  nm_id: number;
  mismatches: FixedFileMismatch[];
  total: number;
}

// ==================== Card Draft ====================
export interface CardDraftPayload {
  title?: string;
  description?: string;
  brand?: string;
  subject_name?: string;
  characteristics?: Record<string, string>;
  dimensions?: { length?: string; width?: string; height?: string; weight?: string };
  package_type?: string;
  complectation?: string;
}

export interface CardDraft {
  id: number;
  card_id: number;
  author_id: number;
  author_name: string | null;
  data: CardDraftPayload;
  updated_at: string;
}

export interface CardConfirmationSummary {
  total_sections: number;
  confirmed_count: number;
  is_fully_confirmed: boolean;
  last_confirmed_at: string | null;
  last_confirmed_by_id: number | null;
  last_confirmed_by_name: string | null;
}

export interface TeamActionLogPayload {
  action: string;
  label: string;
  timestamp?: string;
  meta?: Record<string, any>;
}

export interface TeamWorkAction {
  id: string;
  type: string;
  label: string;
  timestamp: string;
  meta?: Record<string, any>;
}

export interface TeamWorkSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  activeTimeMs: number;
  actions: TeamWorkAction[];
}

export interface TeamWorkDay {
  date: string;
  minutes: number;
  sessions: number;
  fixes: number;
}

export interface TeamWorkMember {
  id: number;
  name: string;
  email: string;
  role: string;
  is_online: boolean;
  today_minutes: number;
  week_minutes: number;
  month_minutes: number;
  fixes_today: number;
  fixes_week: number;
  actions_today: number;
  work_start_today: string | null;
  work_end_today: string | null;
  daily_breakdown: TeamWorkDay[];
  sessions: TeamWorkSession[];
}

export interface TeamWorklog {
  members: TeamWorkMember[];
  total_today_minutes: number;
  total_week_minutes: number;
  team_daily: TeamWorkDay[];
}

// ==================== Ad Analysis / SKU Economics ====================
export type AdAnalysisSourceMode = 'ok' | 'partial' | 'manual' | 'manual_required' | 'error' | 'empty';
export type AdAnalysisItemStatus = 'stop' | 'rescue' | 'control' | 'grow' | 'low_data';
export type AdAnalysisDiagnosis = 'traffic' | 'card' | 'economics' | 'data';
export type AdAnalysisPrecision = 'exact' | 'estimated' | 'manual' | 'mixed' | 'unallocated';
export type AdAnalysisPriority = 'critical' | 'high' | 'medium' | 'low';
export type AdAnalysisTrendSignal = 'worsening' | 'improving' | 'stable' | 'volatile' | 'new' | 'no_history';

export interface AdAnalysisSourceStatus {
  id: string;
  label: string;
  mode: AdAnalysisSourceMode;
  detail: string | null;
  records: number;
  automatic: boolean;
}

export interface AdAnalysisAlert {
  level: 'info' | 'warning' | 'error' | 'success';
  title: string;
  description: string;
  action: string | null;
}

export interface AdAnalysisBudgetMove {
  from_nm_id: number | null;
  from_title: string;
  from_amount: number;
  to_nm_id: number | null;
  to_title: string;
  uplift_percent: number | null;
}

export interface AdAnalysisCampaign {
  advert_id: number | null;
  title: string;
  ad_cost: number;
  ad_gmv: number;
  drr: number;
  linked_skus: number;
  precision: AdAnalysisPrecision;
  precision_label: string;
}

export interface AdAnalysisIssueSummary {
  total: number;
  critical: number;
  warnings: number;
  photos: number;
  price: number;
  text: number;
  docs: number;
  top_titles: string[];
}

export interface AdAnalysisMetrics {
  revenue: number;
  wb_costs: number;
  cost_price: number;
  gross_profit_before_ads: number;
  ad_cost: number;
  net_profit: number;
  profit_per_order: number;
  max_cpo: number;
  actual_cpo: number;
  profit_delta: number;
  views: number;
  clicks: number;
  ad_orders: number;
  ad_gmv: number;
  ctr: number;
  cr: number;
  open_count: number;
  cart_count: number;
  order_count: number;
  buyout_count: number;
  add_to_cart_percent: number;
  cart_to_order_percent: number;
  cpc: number;
  drr: number;
}

export interface AdAnalysisTrend {
  signal: AdAnalysisTrendSignal;
  label: string;
  summary: string;
  actual_cpo_change: number;
  net_profit_change: number;
  profit_delta_change: number;
  orders_change: number;
  ctr_change: number;
  cr_change: number;
}

export interface AdAnalysisItem {
  nm_id: number;
  card_id: number | null;
  title: string | null;
  vendor_code: string | null;
  photo_url: string | null;
  wb_link: string | null;
  workspace_link: string | null;
  price: number | null;
  card_score: number | null;
  status: AdAnalysisItemStatus;
  status_label: string;
  diagnosis: AdAnalysisDiagnosis;
  diagnosis_label: string;
  status_reason: string;
  status_hint: string;
  action_title: string;
  action_description: string;
  priority: AdAnalysisPriority;
  priority_label: string;
  precision: AdAnalysisPrecision;
  precision_label: string;
  trend: AdAnalysisTrend;
  issue_summary: AdAnalysisIssueSummary;
  metrics: AdAnalysisMetrics;
  spend_sources: Record<string, number>;
  insights: string[];
  steps: string[];
  risk_flags: string[];
}

export interface AdAnalysisUploadNeeds {
  period_start: string;
  period_end: string;
  missing_costs_count: number;
  missing_cost_nm_ids: number[];
  needs_manual_spend: boolean;
  needs_manual_finance: boolean;
  can_upload_costs: boolean;
  can_upload_manual_spend: boolean;
  can_upload_manual_finance: boolean;
}

export interface AdAnalysisOverview {
  store_id: number;
  generated_at: string;
  snapshot_ready: boolean;
  period_start: string;
  period_end: string;
  available_period_start: string | null;
  available_period_end: string | null;
  previous_period_start: string | null;
  previous_period_end: string | null;
  selected_preset: string;
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  total_skus: number;
  total_revenue: number;
  total_ad_spend: number;
  total_net_profit: number;
  exact_spend: number;
  estimated_spend: number;
  manual_spend: number;
  unallocated_spend: number;
  profitable_count: number;
  problematic_count: number;
  loss_count: number;
  worsening_count: number;
  improving_count: number;
  main_takeaway: string;
  status_counts: Record<string, number>;
  source_statuses: AdAnalysisSourceStatus[];
  alerts: AdAnalysisAlert[];
  budget_moves: AdAnalysisBudgetMove[];
  campaigns: AdAnalysisCampaign[];
  upload_needs: AdAnalysisUploadNeeds;
  critical_preview: AdAnalysisItem[];
  growth_preview: AdAnalysisItem[];
  items: AdAnalysisItem[];
}

export interface AdAnalysisBootstrapStatus {
  task_id: number | null;
  store_id: number;
  status: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  step: string;
  ready: boolean;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  period_start: string | null;
  period_end: string | null;
}

export interface AdAnalysisUploadUnresolvedRow {
  row_number: number;
  raw_nm_id: string | null;
  raw_vendor_code: string | null;
  raw_title: string | null;
}

export interface AdAnalysisUploadResult {
  imported: number;
  updated: number;
  file_name: string;
  period_start: string | null;
  period_end: string | null;
  notes: string[];
  detected_headers: string[];
  matched_fields: Record<string, string>;
  resolved_by_vendor_code: number;
  unresolved_count: number;
  unresolved_preview: AdAnalysisUploadUnresolvedRow[];
}
