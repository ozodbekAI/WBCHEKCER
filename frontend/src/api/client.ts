const DEFAULT_API_BASE = 'https://rlvzhwmf-8002.euw.devtunnels.ms/api';
const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const LOCAL_API_BASE_RE = /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/i;
const API_BASE =
  RAW_API_BASE && !(import.meta.env.PROD && LOCAL_API_BASE_RE.test(RAW_API_BASE))
    ? RAW_API_BASE
    : DEFAULT_API_BASE;
const API_URL = new URL(API_BASE, window.location.origin);
export const API_ROOT = API_URL.toString().replace(/\/+$/, '');
export const API_ORIGIN = API_URL.origin;
export const AUTH_REQUIRED_EVENT = 'avemod:auth-required';

class ApiClient {
  private token: string | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  constructor() {
    this.token = localStorage.getItem('access_token');
  }

  private setRefreshToken(token: string | null) {
    if (token) {
      localStorage.setItem('refresh_token', token);
    } else {
      localStorage.removeItem('refresh_token');
    }
  }

  private applyAuthPayload(data: any) {
    if (data?.access_token) {
      this.setToken(data.access_token);
    }
    if (Object.prototype.hasOwnProperty.call(data || {}, 'refresh_token')) {
      this.setRefreshToken(data?.refresh_token || null);
    }
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

  buildUrl(path: string): string {
    return new URL(path.replace(/^\//, ''), `${API_ROOT}/`).toString();
  }

  private isAuthEndpoint(path: string): boolean {
    return (
      path === '/auth/login' ||
      path === '/auth/register' ||
      path === '/auth/refresh' ||
      path.startsWith('/auth/accept-invite/')
    );
  }

  private withHeaders(
    headers?: HeadersInit,
    options?: { auth?: boolean; storeId?: number; contentType?: string | null },
  ): Headers {
    const next = new Headers(headers || {});
    const auth = options?.auth !== false;

    if (options?.contentType && !next.has('Content-Type')) {
      next.set('Content-Type', options.contentType);
    }
    if (auth && this.token && !next.has('Authorization')) {
      next.set('Authorization', `Bearer ${this.token}`);
    }
    // ngrok free tier shows a browser warning page for requests without this header
    next.set('ngrok-skip-browser-warning', '1');
    if (options?.storeId && !next.has('X-Store-Id')) {
      next.set('X-Store-Id', String(options.storeId));
    }

    return next;
  }

  private async refreshSession(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      this.logout();
      return null;
    }

    this.refreshPromise = (async () => {
      const res = await fetch(this.buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!res.ok) {
        this.logout();
        return null;
      }

      const data = await res.json().catch(() => null);
      if (!data?.access_token) {
        this.logout();
        return null;
      }

      this.applyAuthPayload(data);
      return data.access_token as string;
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async fetchWithSession(
    path: string,
    init: RequestInit = {},
    options?: { auth?: boolean; storeId?: number; retryOn401?: boolean; contentType?: string | null },
  ): Promise<Response> {
    const auth = options?.auth !== false;
    const retryOn401 = options?.retryOn401 !== false;
    const execute = () =>
      fetch(this.buildUrl(path), {
        ...init,
        headers: this.withHeaders(init.headers, options),
      });

    let res = await execute();
    if (res.status === 401 && auth && retryOn401 && !this.isAuthEndpoint(path)) {
      const refreshed = await this.refreshSession();
      if (refreshed) {
        res = await execute();
      }
    }

    if (res.status === 401 && auth && !this.isAuthEndpoint(path)) {
      this.logout();
      if (window.location.pathname !== '/login') {
        const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        const to = next && next !== '/login' ? `/login?next=${encodeURIComponent(next)}` : '/login';
        window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { to } }));
      }
    }

    return res;
  }

  private async buildError(res: Response): Promise<Error> {
    const err = await res.json().catch(() => ({ detail: `Error ${res.status}` }));
    const detail = err?.detail;
    if (typeof detail === 'string') {
      return new Error(detail);
    }
    if (detail && typeof detail === 'object') {
      const e = new Error((detail.message as string) || `Error ${res.status}`) as Error & {
        code?: string;
        email?: string;
        detail?: any;
        status?: number;
      };
      e.code = detail.code;
      e.email = detail.email;
      e.detail = detail;
      e.status = res.status;
      return e;
    }
    return new Error(`Error ${res.status}`);
  }

  async requestRaw(
    path: string,
    init: RequestInit = {},
    options?: { auth?: boolean; storeId?: number; retryOn401?: boolean; contentType?: string | null },
  ): Promise<Response> {
    const res = await this.fetchWithSession(path, init, options);
    if (!res.ok) {
      throw await this.buildError(res);
    }
    return res;
  }

  async requestJson<T>(
    path: string,
    init: RequestInit = {},
    options?: { auth?: boolean; storeId?: number; retryOn401?: boolean; contentType?: string | null },
  ): Promise<T> {
    const res = await this.requestRaw(path, init, options);
    if (res.status === 204) return null as T;
    const text = await res.text();
    if (!text) return null as T;
    return JSON.parse(text);
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

    const relativePath = `${path}${url.search}`;
    return this.requestJson<T>(
      relativePath,
      {
        method,
        body: body ? JSON.stringify(body) : undefined,
      },
      {
        contentType: 'application/json',
      },
    );
  }

  // ============ Auth ============
  async login(email: string, password: string) {
    const data = await this.request<any>('POST', '/auth/login', { email, password });
    this.applyAuthPayload(data);
    return data;
  }

  async register(email: string, password: string, first_name?: string) {
    return this.request<any>('POST', '/auth/register', { email, password, first_name });
  }

  async requestRegisterAccess(email: string, first_name?: string, last_name?: string) {
    return this.request<{ message: string; cooldown_seconds: number }>('POST', '/auth/register/request-access', {
      email, first_name, last_name,
    });
  }

  async registerStart(email: string, password: string, first_name?: string, last_name?: string) {
    return this.request<{ message: string; cooldown_seconds: number; expires_in_seconds: number }>('POST', '/auth/register/start', {
      email, password, first_name, last_name,
    });
  }

  async resendRegisterCode(email: string) {
    return this.request<{ message: string; cooldown_seconds: number; expires_in_seconds: number }>('POST', '/auth/register/resend-code', { email });
  }

  async verifyRegisterCode(email: string, code: string) {
    const data = await this.request<any>('POST', '/auth/register/verify-code', { email, code });
    this.applyAuthPayload(data);
    return data;
  }

  async getMe() {
    return this.request<any>('GET', '/auth/me');
  }

  async updateMe(data: { first_name?: string; last_name?: string; phone?: string }) {
    return this.request<any>('PATCH', '/auth/me', data);
  }

  async changePassword(currentPassword: string, newPassword: string) {
    return this.request<any>('POST', '/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  async uploadMyAvatar(file: File) {
    const form = new FormData();
    form.append('file', file);
    const resp = await this.requestRaw('/auth/me/avatar', {
      method: 'POST',
      body: form,
    });
    return resp.json();
  }

  async heartbeat() {
    return this.request<any>('POST', '/auth/heartbeat').catch(() => {});
  }

  logout() {
    this.setToken(null);
    this.setRefreshToken(null);
  }

  // ============ Stores ============
  async getStores() {
    return this.request<any[]>('GET', '/stores');
  }

  async getStore(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}`);
  }

  async updateStore(storeId: number, data: { name?: string; api_key?: string }) {
    return this.request<any>('PATCH', `/stores/${storeId}`, data);
  }

  async updateStoreFeatureKey(storeId: number, slotKey: string, apiKey: string) {
    return this.request<any>('PUT', `/stores/${storeId}/keys/${slotKey}`, { api_key: apiKey });
  }

  async deleteStoreFeatureKey(storeId: number, slotKey: string) {
    return this.request<any>('DELETE', `/stores/${storeId}/keys/${slotKey}`);
  }

  async getStoreStats(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}/stats`);
  }

  async onboard(apiKey: string, name?: string, useAi: boolean = true) {
    return this.request<any>('POST', '/stores/onboard', {
      api_key: apiKey, name: name || undefined, use_ai: useAi,
    });
  }

  async startOnboarding(apiKey: string, name?: string, useAi: boolean = true) {
    return this.request<import('../types').OnboardStartResponse>('POST', '/stores/onboard/start', {
      api_key: apiKey, name: name || undefined, use_ai: useAi,
    });
  }

  async getOnboardingStatus(taskId: string) {
    return this.request<import('../types').OnboardingTaskStatus>('GET', `/stores/onboard/status/${taskId}`);
  }

  async cancelOnboarding(taskId: string) {
    return this.request<import('../types').OnboardingTaskStatus>('POST', `/stores/onboard/status/${taskId}/cancel`);
  }

  async syncCards(storeId: number) {
    return this.request<any>('POST', `/stores/${storeId}/sync`);
  }

  async analyzeStore(storeId: number, useAi: boolean = true, limit?: number) {
    return this.request<any>('POST', `/stores/${storeId}/analyze`, undefined, {
      use_ai: useAi, limit: limit,
    });
  }

  async startSync(storeId: number, mode: 'incremental' | 'manual' = 'incremental', nmIds?: number[]) {
    return this.request<{ task_id: string; status: string; mode: string }>('POST', `/stores/${storeId}/sync/start`, {
      mode, nm_ids: nmIds,
    });
  }

  async startAnalyzeAll(storeId: number) {
    return this.request<{ task_id: string; status: string; mode: string }>('POST', `/stores/${storeId}/sync/analyze-all`);
  }

  async startResetAndAnalyze(storeId: number) {
    return this.request<{ task_id: string; status: string; mode: string }>('POST', `/stores/${storeId}/sync/reset-and-analyze`);
  }

  async getSyncStatus(storeId: number, taskId: string) {
    return this.request<any>('GET', `/stores/${storeId}/sync/status/${taskId}`);
  }

  async cancelSyncTask(storeId: number, taskId: string) {
    return this.request<any>('POST', `/stores/${storeId}/sync/status/${taskId}/cancel`);
  }

  async getSchedulerStatus() {
    return this.request<{
      is_running: boolean;
      interval_sec: number;
      last_tick_at: string | null;
      next_tick_at: string | null;
      next_tick_in_sec: number | null;
    }>('GET', `/stores/scheduler/status`);
  }

  async getSyncPreview(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}/sync/preview`);
  }

  // ============ Promotion / A/B tests ============
  async getPromotionList(
    storeId: number,
    status: 'running' | 'pending' | 'finished' | 'failed',
    params?: { page?: number; page_size?: number },
  ) {
    const search = new URLSearchParams();
    if (params?.page !== undefined) search.set('page', String(params.page));
    if (params?.page_size !== undefined) search.set('page_size', String(params.page_size));
    const path = search.size ? `/promotion/${status}?${search.toString()}` : `/promotion/${status}`;
    return this.requestStoreJson<any>(storeId, path);
  }

  async getPromotionBalance(storeId: number) {
    return this.requestStoreJson<any>(storeId, '/promotion/balance');
  }

  async createPromotionCompany(storeId: number, payload: Record<string, any>) {
    return this.requestStoreJson<any>(
      storeId,
      '/promotion/create_company',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      { contentType: 'application/json' },
    );
  }

  async updatePromotionCompany(storeId: number, payload: Record<string, any>) {
    return this.requestStoreJson<any>(
      storeId,
      '/promotion/update',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      { contentType: 'application/json' },
    );
  }

  async startPromotionCompany(storeId: number, companyId: number) {
    return this.requestStoreJson<any>(storeId, `/promotion/company/${companyId}/start`, { method: 'POST' });
  }

  async stopPromotionCompany(storeId: number, companyId: number) {
    return this.requestStoreJson<any>(storeId, `/promotion/company/${companyId}/stop`, { method: 'POST' });
  }

  // ============ Ad Analysis / SKU Economics ============
  async getAdAnalysisOverview(storeId: number, params?: {
    days?: number;
    preset?: string;
    period_start?: string;
    period_end?: string;
    page?: number;
    page_size?: number;
    status?: string;
    search?: string;
    force?: boolean;
  }) {
    return this.request<import('../types').AdAnalysisOverview>('GET', `/stores/${storeId}/ad-analysis/overview`, undefined, params);
  }

  async startAdAnalysisBootstrap(storeId: number, force: boolean = false) {
    return this.request<import('../types').AdAnalysisBootstrapStatus>('POST', `/stores/${storeId}/ad-analysis/bootstrap/start`, undefined, {
      force: force || undefined,
    });
  }

  async getAdAnalysisBootstrapStatus(storeId: number) {
    return this.request<import('../types').AdAnalysisBootstrapStatus>('GET', `/stores/${storeId}/ad-analysis/bootstrap/status`);
  }

  async uploadAdAnalysisCosts(storeId: number, file: File) {
    const form = new FormData();
    form.append('file', file);
    const resp = await this.requestRaw(`/stores/${storeId}/ad-analysis/costs/upload`, {
      method: 'POST',
      body: form,
    });
    return resp.json() as Promise<import('../types').AdAnalysisUploadResult>;
  }

  async uploadAdAnalysisManualSpend(storeId: number, file: File, periodStart: string, periodEnd: string) {
    const form = new FormData();
    form.append('file', file);
    form.append('period_start', periodStart);
    form.append('period_end', periodEnd);
    const resp = await this.requestRaw(`/stores/${storeId}/ad-analysis/manual-spend/upload`, {
      method: 'POST',
      body: form,
    });
    return resp.json() as Promise<import('../types').AdAnalysisUploadResult>;
  }

  async uploadAdAnalysisFinance(storeId: number, file: File, periodStart: string, periodEnd: string) {
    const form = new FormData();
    form.append('file', file);
    form.append('period_start', periodStart);
    form.append('period_end', periodEnd);
    const resp = await this.requestRaw(`/stores/${storeId}/ad-analysis/finance/upload`, {
      method: 'POST',
      body: form,
    });
    return resp.json() as Promise<import('../types').AdAnalysisUploadResult>;
  }

  // ============ Cards ============
  async getCards(storeId: number, page = 1, limit = 50, filters?: Record<string, any>) {
    return this.request<any>('GET', `/stores/${storeId}/cards`, undefined, { page, limit, ...filters });
  }

  async getCard(storeId: number, cardId: number) {
    return this.request<any>('GET', `/stores/${storeId}/cards/${cardId}`);
  }

  async getDescriptionEditorContext(
    storeId: number,
    cardId: number,
    draft?: import('../types').DescriptionEditorDraftPayload,
  ) {
    return this.request<import('../types').DescriptionEditorContext>(
      'POST',
      `/stores/${storeId}/cards/${cardId}/description-editor/context`,
      { draft: draft || undefined },
    );
  }

  async generateDescriptionEditorValue(
    storeId: number,
    cardId: number,
    data: {
      draft?: import('../types').DescriptionEditorDraftPayload;
      instructions?: string;
    },
  ) {
    return this.request<import('../types').DescriptionEditorGenerateResult>(
      'POST',
      `/stores/${storeId}/cards/${cardId}/description-editor/generate`,
      data,
    );
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
      source_url: sourceUrl, slot,
    });
  }

  async syncCardPhotos(storeId: number, cardId: number, photos: string[]) {
    return this.request<any>('POST', `/stores/${storeId}/cards/${cardId}/photos/sync`, {
      photos,
    });
  }

  async uploadUserPhotoAsset(file: File, options?: { assetType?: string; name?: string }) {
    const form = new FormData();
    form.append('file', file);
    if (options?.assetType) form.append('asset_type', options.assetType);
    if (options?.name) form.append('name', options.name);

    const resp = await this.requestRaw('/photo-assets/user/upload', {
      method: 'POST',
      body: form,
    });
    return resp.json();
  }

  async importUserPhotoAssetFromUrl(data: {
    asset_type: string;
    source_url: string;
    name?: string;
    description?: string;
    prompt?: string;
    category?: string;
    subcategory?: string;
  }) {
    return this.requestJson<any>(
      '/photo-assets/user/import',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      { contentType: 'application/json' },
    );
  }

  async getPhotoCatalogAll() {
    return this.requestJson<any>('/photo/catalog/all');
  }

  async getPhotoGalleryAssets(assetType: 'scene' | 'model') {
    return this.requestJson<any>(`/photo-assets/catalog?asset_type=${encodeURIComponent(assetType)}`);
  }

  async getPhotoChatHistory(threadId?: number) {
    const params = threadId ? `?thread_id=${threadId}` : '';
    return this.requestJson<any>(`/photo/chat/history${params}`);
  }

  async createNewPhotoThread() {
    return this.requestJson<any>('/photo/threads/new', { method: 'POST' });
  }

  async uploadPhotoChatAsset(file: File) {
    const form = new FormData();
    form.append('file', file);
    const resp = await this.requestRaw('/photo/assets/upload', {
      method: 'POST',
      body: form,
    });
    return resp.json();
  }

  async importPhotoChatAsset(sourceUrl: string) {
    return this.requestJson<any>(
      '/photo/assets/import',
      {
        method: 'POST',
        body: JSON.stringify({ source_url: sourceUrl }),
      },
      { contentType: 'application/json' },
    );
  }

  async streamPhotoChat(payload: Record<string, any>) {
    return this.requestRaw(
      '/photo/chat/stream',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      { contentType: 'application/json' },
    );
  }

  async clearPhotoChat(threadId?: number, clearMode: 'messages' | 'context' | 'all' = 'all') {
    return this.requestJson<any>(
      '/photo/chat/clear',
      {
        method: 'POST',
        body: JSON.stringify({ thread_id: threadId, clear_mode: clearMode }),
      },
      { contentType: 'application/json' },
    );
  }

  async deletePhotoChatMessages(messageIds: number[], threadId?: number) {
    return this.requestJson<any>(
      '/photo/chat/messages/delete',
      {
        method: 'POST',
        body: JSON.stringify({ message_ids: messageIds, thread_id: threadId }),
      },
      { contentType: 'application/json' },
    );
  }

  async deletePhotoChatAssets(assetIds: number[], threadId?: number) {
    return this.requestJson<any>(
      '/photo/chat/assets/delete',
      {
        method: 'POST',
        body: JSON.stringify({ asset_ids: assetIds, thread_id: threadId }),
      },
      { contentType: 'application/json' },
    );
  }

  async getCardIssues(storeId: number, cardId: number, status?: string) {
    return this.request<any[]>('GET', `/stores/${storeId}/cards/${cardId}/issues`, undefined, { status });
  }

  async getCardsQueue(storeId: number, limit = 100) {
    return this.request<any[]>('GET', `/stores/${storeId}/cards/queue`, undefined, { limit });
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

  async getIssuesGrouped(storeId: number, limit = 200) {
    return this.request<any>('GET', `/stores/${storeId}/issues/grouped`, undefined, { limit });
  }

  async getIssueStats(storeId: number) {
    return this.request<any>('GET', `/stores/${storeId}/issues/stats`);
  }

  async getNextIssue(storeId: number, afterId?: number, cardId?: number, severity?: string) {
    return this.request<any>('GET', `/stores/${storeId}/issues/queue/next`, undefined, {
      ...(afterId !== undefined && { after: afterId }),
      ...(cardId !== undefined && { card_id: cardId }),
      ...(severity !== undefined && { severity }),
    });
  }

  async getQueueProgress(storeId: number, severity?: string) {
    return this.request<any>('GET', `/stores/${storeId}/issues/queue/progress`, undefined, {
      ...(severity !== undefined && { severity }),
    });
  }

  async fixIssue(storeId: number, issueId: number, fixedValue: string, applyToWb = false) {
    return this.request<any>('POST', `/stores/${storeId}/issues/${issueId}/fix`, {
      fixed_value: fixedValue, apply_to_wb: applyToWb,
    });
  }

  async skipIssue(storeId: number, issueId: number, reason?: string) {
    return this.request<any>('POST', `/stores/${storeId}/issues/${issueId}/skip`, { reason: reason || null });
  }

  async unskipIssue(storeId: number, issueId: number) {
    return this.request<any>('POST', `/stores/${storeId}/issues/${issueId}/unskip`);
  }

  async postponeIssue(storeId: number, issueId: number, reason?: string) {
    return this.request<any>('POST', `/stores/${storeId}/issues/${issueId}/postpone`, { reason: reason || null });
  }

  async assignIssue(storeId: number, issueId: number, assigneeIds: number[] | number, note?: string) {
    const normalized = (Array.isArray(assigneeIds) ? assigneeIds : [assigneeIds])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);

    return this.request<any>('POST', `/stores/${storeId}/issues/${issueId}/assign`, {
      assignee_ids: normalized,
      note: note || undefined,
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
    const data = await this.request<any>('POST', `/auth/accept-invite/${token}`, { password, first_name });
    this.applyAuthPayload(data);
    return data;
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

  async getTeamTickets(storeId: number, params?: { status?: string; type?: string }) {
    return this.request<import('../types').TeamTicket[]>('GET', `/stores/${storeId}/team/tickets`, undefined, params);
  }

  async createTeamTicket(storeId: number, data: {
    type: 'delegation' | 'approval';
    issue_id?: number;
    approval_id?: number;
    card_id?: number;
    issue_title?: string;
    issue_severity?: string;
    issue_code?: string;
    card_title?: string;
    card_photo?: string;
    card_nm_id?: number;
    card_vendor_code?: string;
    to_user_id: number;
    note?: string;
  }) {
    return this.request<import('../types').TeamTicket>('POST', `/stores/${storeId}/team/tickets`, data);
  }

  async completeTeamTicket(storeId: number, ticketId: number) {
    return this.request<import('../types').TeamTicket>('POST', `/stores/${storeId}/team/tickets/${ticketId}/done`);
  }

  async logTeamActivity(storeId: number, data: import('../types').TeamActionLogPayload) {
    return this.request<void>('POST', `/stores/${storeId}/team/activity/log`, data);
  }

  async getTeamWorklog(storeId: number, days = 30) {
    return this.request<import('../types').TeamWorklog>('GET', `/stores/${storeId}/team/worklog`, undefined, { days });
  }

  async getApprovals(storeId: number, params?: { status?: string; page?: number; limit?: number }) {
    return this.request<any>('GET', `/stores/${storeId}/team/approvals`, undefined, params);
  }

  async submitForReview(storeId: number, cardId: number, note?: string, reviewerIds?: number[]) {
    return this.request<any>('POST', `/stores/${storeId}/team/approvals/submit`, {
      card_id: cardId,
      note: note || null,
      reviewer_ids: reviewerIds,
    });
  }

  async reviewApproval(storeId: number, approvalId: number, action: 'approve' | 'reject', comment?: string) {
    return this.request<any>('POST', `/stores/${storeId}/team/approvals/${approvalId}/review`, { action, comment: comment || null });
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
    const resp = await this.requestRaw(`/stores/${storeId}/fixed-file/template`);
    return resp.blob();
  }

  async uploadFixedFile(storeId: number, file: File, replaceAll = false) {
    const form = new FormData();
    form.append('file', file);
    const url = `/stores/${storeId}/fixed-file/upload?replace_all=${replaceAll}`;
    const resp = await this.requestRaw(url, {
      method: 'POST',
      body: form,
    });
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

  // ─── Section confirmation ────────────────────────────────────────────────

  async getConfirmedSections(storeId: number, cardId: number): Promise<string[]> {
    return this.request<string[]>('GET', `/stores/${storeId}/cards/${cardId}/confirmed-sections`);
  }

  async confirmSection(storeId: number, cardId: number, section: string): Promise<void> {
    return this.request<void>('POST', `/stores/${storeId}/cards/${cardId}/confirmed-sections/${section}`);
  }

  async unconfirmSection(storeId: number, cardId: number, section: string): Promise<void> {
    return this.request<void>('DELETE', `/stores/${storeId}/cards/${cardId}/confirmed-sections/${section}`);
  }

  // ─── Card Drafts ──────────────────────────────────────────────────────────

  async getCardDraft(storeId: number, cardId: number): Promise<import('../types').CardDraft | null> {
    return this.request<import('../types').CardDraft | null>('GET', `/stores/${storeId}/cards/${cardId}/draft`);
  }

  async saveCardDraft(storeId: number, cardId: number, data: import('../types').CardDraftPayload): Promise<import('../types').CardDraft> {
    return this.request<import('../types').CardDraft>('PUT', `/stores/${storeId}/cards/${cardId}/draft`, data);
  }

  async deleteCardDraft(storeId: number, cardId: number): Promise<void> {
    return this.request<void>('DELETE', `/stores/${storeId}/cards/${cardId}/draft`);
  }

  async applyCard(storeId: number, cardId: number): Promise<import('../types').CardDetail> {
    return this.request<import('../types').CardDetail>('POST', `/stores/${storeId}/cards/${cardId}/apply`);
  }

  async requestStoreJson<T>(
    storeId: number,
    path: string,
    init: RequestInit = {},
    options?: { retryOn401?: boolean; contentType?: string | null },
  ) {
    return this.requestJson<T>(path, init, { ...options, storeId });
  }

  async requestStoreRaw(
    storeId: number,
    path: string,
    init: RequestInit = {},
    options?: { retryOn401?: boolean; contentType?: string | null },
  ) {
    return this.requestRaw(path, init, { ...options, storeId });
  }
}

export const api = new ApiClient();
export default api;
