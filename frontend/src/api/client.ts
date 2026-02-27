const DEFAULT_API_BASE = '/api';
const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).trim().replace(/\/+$/, '');
const IS_LOCALHOST_BASE = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(RAW_API_BASE);

const API_BASE = !import.meta.env.DEV && IS_LOCALHOST_BASE ? DEFAULT_API_BASE : RAW_API_BASE;

class ApiClient {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem('access_token');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('access_token', token);
    } else {
      localStorage.removeItem('access_token');
    }
  }

  getToken(): string | null {
    return this.token;
  }

  private buildUrl(path: string): string {
    return new URL(`${API_BASE}${path}`, window.location.origin).toString();
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const url = new URL(this.buildUrl(path));
    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, String(val));
        }
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      const isAuthEndpoint =
        path === '/auth/login' ||
        path === '/auth/register' ||
        path.startsWith('/auth/accept-invite/');

      const err = await res.json().catch(() => ({ detail: 'Unauthorized' }));

      if (!isAuthEndpoint) {
        this.setToken(null);
        localStorage.removeItem('refresh_token');
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }

      throw new Error(err.detail || 'Unauthorized');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Network error' }));
      throw new Error(err.detail || `Error ${res.status}`);
    }

    if (res.status === 204) return null as T;
    
    const text = await res.text();
    if (!text) return null as T;
    return JSON.parse(text);
  }

  // ============ Auth ============
  async login(email: string, password: string) {
    const data = await this.request<any>('POST', '/auth/login', { email, password });
    this.setToken(data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    return data;
  }

  async register(email: string, password: string, first_name?: string) {
    return this.request<any>('POST', '/auth/register', { email, password, first_name });
  }

  async getMe() {
    return this.request<any>('GET', '/auth/me');
  }

  async heartbeat() {
    return this.request<any>('POST', '/auth/heartbeat').catch(() => {});
  }

  logout() {
    this.setToken(null);
    localStorage.removeItem('refresh_token');
  }

  // ============ Stores ============
  async getStores() {
    return this.request<any[]>('GET', '/stores');
  }

  async getStore(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}`);
  }

  async getStoreStats(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}/stats`);
  }

  async onboard(apiKey: string, name?: string, useAi: boolean = true) {
    return this.request<any>('POST', '/stores/onboard', {
      api_key: apiKey,
      name: name || undefined,
      use_ai: useAi,
    });
  }

  async syncCards(storeId: number) {
    return this.request<any>('POST', `/stores/${storeId}/sync`);
  }

  async analyzeStore(storeId: number, useAi: boolean = true, limit?: number) {
    return this.request<any>('POST', `/stores/${storeId}/analyze`, undefined, {
      use_ai: useAi,
      limit: limit,
    });
  }

  async startSync(storeId: number, mode: 'incremental' | 'manual' = 'incremental', nmIds?: number[]) {
    return this.request<{ task_id: string; status: string; mode: string }>('POST', `/stores/${storeId}/sync/start`, {
      mode,
      nm_ids: nmIds,
    });
  }

  async startAnalyzeAll(storeId: number) {
    return this.request<{ task_id: string; status: string; mode: string }>('POST', `/stores/${storeId}/sync/analyze-all`);
  }

  async getSyncStatus(storeId: number, taskId: string) {
    return this.request<any>('GET', `/stores/${storeId}/sync/status/${taskId}`);
  }

  async getSyncPreview(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}/sync/preview`);
  }

  // ============ Cards ============
  async getCards(storeId: number, page = 1, limit = 50, filters?: Record<string, any>) {
    return this.request<any>('GET', `/stores/${storeId}/cards`, undefined, {
      page,
      limit,
      ...filters,
    });
  }

  async getCard(storeId: number, cardId: number) {
    return this.request<any>('GET', `/stores/${storeId}/cards/${cardId}`);
  }

  async getWbCardsLive(
    storeId: number,
    params?: {
      limit?: number;
      with_photo?: number;
      q?: string;
      cursor_updated_at?: string;
      cursor_nm_id?: number;
    },
  ) {
    return this.request<any>('GET', `/stores/${storeId}/cards/wb/live`, undefined, params);
  }

  async replaceWbCardPhoto(storeId: number, nmId: number, slot: number, sourceUrl: string) {
    return this.request<any>('POST', `/stores/${storeId}/cards/wb/${nmId}/photos/replace`, {
      source_url: sourceUrl,
      slot,
    });
  }

  async getCardIssues(storeId: number, cardId: number, status?: string) {
    return this.request<any[]>('GET', `/stores/${storeId}/cards/${cardId}/issues`, undefined, {
      status,
    });
  }

  // ============ Dashboard ============
  async getDashboard() {
    return this.request<any>('GET', '/dashboard');
  }

  async getStoreDashboard(storeId: number) {
    return this.request<any>('GET', `/dashboard/stores/${storeId}`);
  }

  // ============ Issues ============
  async getIssues(storeId: number, params?: Record<string, any>) {
    return this.request<any>('GET', `/stores/${storeId}/issues`, undefined, params);
  }

  async getIssuesGrouped(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}/issues/grouped`);
  }

  async getIssueStats(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}/issues/stats`);
  }

  async getNextIssue(storeId: number, afterId?: number) {
    return this.request<any>('GET', `/stores/${storeId}/issues/queue/next`, undefined, {
      after: afterId,
    });
  }

  async getQueueProgress(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}/issues/queue/progress`);
  }

  async fixIssue(storeId: number, issueId: number, fixedValue: string, applyToWb = false) {
    return this.request<any>('POST', `/stores/${storeId}/issues/${issueId}/fix`, {
      fixed_value: fixedValue,
      apply_to_wb: applyToWb,
    });
  }

  async skipIssue(storeId: number, issueId: number, reason?: string) {
    return this.request<any>('POST', `/stores/${storeId}/issues/${issueId}/skip`, {
      reason: reason || null,
    });
  }

  async postponeIssue(storeId: number, issueId: number, reason?: string) {
    return this.request<any>('POST', `/stores/${storeId}/issues/${issueId}/postpone`, {
      reason: reason || null,
    });
  }

  async applyAllFixes(storeId: number) {
    return this.request<any>('POST', `/stores/${storeId}/issues/apply-all`);
  }

  // ============ Team & Approvals ============
  async getTeamMembers(storeId: number) {
    return this.request<any[]>('GET', `/stores/${storeId}/team/members`);
  }

  async updateTeamMember(storeId: number, userId: number, data: { role?: string; is_active?: boolean; custom_permissions?: string[] | null }) {
    return this.request<any>('PATCH', `/stores/${storeId}/team/members/${userId}`, data);
  }

  async inviteTeamMember(storeId: number, data: { email: string; role: string; first_name?: string; custom_permissions?: string[] }) {
    return this.request<any>('POST', `/stores/${storeId}/team/invite`, data);
  }

  async getInviteInfo(token: string) {
    return this.request<{ email: string; first_name: string | null; role: string }>('GET', `/auth/accept-invite/${token}`);
  }

  async acceptInvite(token: string, password: string, first_name?: string) {
    return this.request<any>('POST', `/auth/accept-invite/${token}`, { password, first_name });
  }

  async getRoles(storeId: number) {
    return this.request<any[]>('GET', `/stores/${storeId}/team/roles`);
  }

  async getPermissionsList(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}/team/permissions`);
  }

  async getTeamActivity(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}/team/activity`);
  }

  async getApprovals(storeId: number, params?: { status?: string; page?: number; limit?: number }) {
    return this.request<any>('GET', `/stores/${storeId}/team/approvals`, undefined, params);
  }

  async submitForReview(storeId: number, cardId: number, note?: string) {
    return this.request<any>('POST', `/stores/${storeId}/team/approvals/submit`, {
      card_id: cardId,
      note: note || null,
    });
  }

  async reviewApproval(storeId: number, approvalId: number, action: 'approve' | 'reject', comment?: string) {
    return this.request<any>('POST', `/stores/${storeId}/team/approvals/${approvalId}/review`, {
      action,
      comment: comment || null,
    });
  }

  async applyApproval(storeId: number, approvalId: number) {
    return this.request<any>('POST', `/stores/${storeId}/team/approvals/${approvalId}/apply`);
  }

  async cancelApproval(storeId: number, approvalId: number) {
    return this.request<any>('DELETE', `/stores/${storeId}/team/approvals/${approvalId}`);
  }

  // ─── Fixed File ───────────────────────────────────────────────────────────

  async getFixedFileStatus(storeId: number) {
    return this.request<{ has_fixed_file: boolean }>('GET', `/stores/${storeId}/fixed-file/status`);
  }

  async downloadFixedTemplate(storeId: number): Promise<Blob> {
    const resp = await fetch(this.buildUrl(`/stores/${storeId}/fixed-file/template`), {
      headers: { Authorization: `Bearer ${this.token || ''}` },
    });
    if (!resp.ok) throw new Error('Template download failed');
    return resp.blob();
  }

  async uploadFixedFile(storeId: number, file: File, replaceAll = false) {
    const form = new FormData();
    form.append('file', file);
    const url = `/stores/${storeId}/fixed-file/upload?replace_all=${replaceAll}`;
    const resp = await fetch(this.buildUrl(url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token || ''}` },
      body: form,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || 'Upload failed');
    }
    return resp.json();
  }

  async getFixedFileEntries(storeId: number, params?: { nm_id?: number; page?: number; limit?: number }) {
    return this.request<import('../types').FixedEntryListOut>('GET', `/stores/${storeId}/fixed-file`, undefined, params as any);
  }

  async updateFixedEntry(storeId: number, entryId: number, fixedValue: string) {
    return this.request<import('../types').FixedFileEntry>('PUT', `/stores/${storeId}/fixed-file/${entryId}`, { fixed_value: fixedValue });
  }

  async deleteFixedEntry(storeId: number, entryId: number) {
    return this.request<void>('DELETE', `/stores/${storeId}/fixed-file/${entryId}`);
  }

  async deleteAllFixedEntries(storeId: number) {
    return this.request<void>('DELETE', `/stores/${storeId}/fixed-file`);
  }

  async recheckCardFixed(storeId: number, nmId: number) {
    return this.request<import('../types').RecheckResult>('POST', `/stores/${storeId}/fixed-file/recheck/${nmId}`);
  }
}

export const api = new ApiClient();
export default api;
