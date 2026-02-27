// ==================== User ====================
export interface User {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
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
  critical_issues_count: number;
  warnings_count: number;
  improvements_count: number;
  growth_points_count: number;
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
}

export interface IssuesGrouped {
  critical: IssueWithCard[];
  warnings: IssueWithCard[];
  improvements: IssueWithCard[];
  postponed: IssueWithCard[];
  critical_count: number;
  warnings_count: number;
  improvements_count: number;
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
