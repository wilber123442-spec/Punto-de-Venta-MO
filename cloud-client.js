// Mi Caja C$ cloud client. The publishable key is designed for client use;
// row-level security remains the authority for every database operation.
(() => {
  const SUPABASE_URL = 'https://sopebnliutlghshicyxb.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_zA1iS0EDl0W11pzavDr4dw_eVaeMEs9';
  const SESSION_KEY = 'mn_cloud_session';

  class MiCajaCloudClient {
    constructor() {
      this.session = this.readSession();
      this.deviceId = localStorage.getItem('mn_cloud_device_id');
      if (!this.deviceId) {
        this.deviceId = crypto.randomUUID();
        localStorage.setItem('mn_cloud_device_id', this.deviceId);
      }
    }

    readSession() {
      try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
      catch { return null; }
    }

    saveSession(session) {
      this.session = session || null;
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
    }

    async request(path, options = {}, requiresAuth = false) {
      const headers = new Headers(options.headers || {});
      headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
      headers.set('Content-Type', 'application/json');
      if (requiresAuth) {
        await this.ensureSession();
        headers.set('Authorization', `Bearer ${this.session.access_token}`);
      }
      let response;
      try {
        response = await fetch(`${SUPABASE_URL}${path}`, {
          ...options, headers, signal: AbortSignal.timeout(20000)
        });
      } catch (error) {
        throw new Error('No se pudo conectar. Revisa internet; tus datos locales siguen disponibles.');
      }
      const body = await response.text();
      let data = null;
      try { data = body ? JSON.parse(body) : null; } catch {}
      if (!response.ok) {
        const message = data?.msg || data?.message || data?.error_description || data?.error || `Error ${response.status}`;
        throw new Error(message);
      }
      return data;
    }

    async checkConnection() {
      await this.request('/auth/v1/settings');
      return true;
    }

    async signUp(email, password) {
      const result = await this.request('/auth/v1/signup', {
        method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), password })
      });
      if (result?.access_token) this.saveSession(result);
      return result;
    }

    async signIn(email, password) {
      const result = await this.request('/auth/v1/token?grant_type=password', {
        method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), password })
      });
      this.saveSession(result);
      return result;
    }

    async ensureSession() {
      if (!this.session?.refresh_token) throw new Error('Inicia sesión con tu cuenta en la nube.');
      if (Number(this.session.expires_at || 0) > Math.floor(Date.now() / 1000) + 60) return;
      const result = await this.request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: this.session.refresh_token })
      });
      this.saveSession(result);
    }

    async signOut() {
      try { if (this.session?.access_token) await this.request('/auth/v1/logout', { method: 'POST' }, true); }
      finally { this.saveSession(null); }
    }

    rpc(name, args) {
      return this.request(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
        method: 'POST', body: JSON.stringify(args)
      }, true);
    }

    select(table, query) {
      const params = new URLSearchParams(query);
      return this.request(`/rest/v1/${encodeURIComponent(table)}?${params}`, {}, true);
    }

    update(table, query, values) {
      const params = new URLSearchParams(query);
      return this.request(`/rest/v1/${encodeURIComponent(table)}?${params}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(values)
      }, true);
    }

    upsert(table, rows, conflict = 'business_id,id') {
      const params = new URLSearchParams({ on_conflict: conflict });
      return this.request(`/rest/v1/${encodeURIComponent(table)}?${params}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(rows)
      }, true);
    }

    remove(table, query) {
      const params = new URLSearchParams(query);
      return this.request(`/rest/v1/${encodeURIComponent(table)}?${params}`, {
        method: 'DELETE', headers: { Prefer: 'return=minimal' }
      }, true);
    }

    get userId() { return this.session?.user?.id || null; }
    get connected() { return Boolean(this.session?.access_token && this.userId); }
    get projectUrl() { return SUPABASE_URL; }
  }

  window.miCajaCloud = new MiCajaCloudClient();
})();

