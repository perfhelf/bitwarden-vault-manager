/**
 * Bitwarden API Client
 * Handles authentication, vault sync, cipher updates, and deletion
 * 
 * Supports two auth methods:
 * 1. Personal API Key (recommended, bypasses CAPTCHA)
 * 2. Master password (may trigger CAPTCHA)
 * 
 * Uses Vite proxy / Vercel rewrites to bypass CORS
 */

const SERVERS = {
  '': {  // bitwarden.com (default)
    apiUrl: '/bw-api',
    identityUrl: '/bw-identity',
  },
  'https://vault.bitwarden.eu': {
    apiUrl: '/bw-eu-api',
    identityUrl: '/bw-eu-identity',
  },
};

export class BitwardenClient {
  constructor(serverUrl = '') {
    const config = SERVERS[serverUrl];
    if (config) {
      this.apiUrl = config.apiUrl;
      this.identityUrl = config.identityUrl;
    } else {
      const base = serverUrl.replace(/\/+$/, '');
      this.apiUrl = `${base}/api`;
      this.identityUrl = `${base}/identity`;
    }
    this.accessToken = null;
    this.refreshToken = null;
  }

  /**
   * Prelogin: get KDF parameters for the account
   */
  async prelogin(email) {
    const res = await fetch(`${this.identityUrl}/accounts/prelogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(`Prelogin failed: ${res.status}`);
    const data = await res.json();
    return {
      kdf: data.kdf ?? data.Kdf ?? 0,
      kdfIterations: data.kdfIterations ?? data.KdfIterations ?? 600000,
      kdfMemory: data.kdfMemory ?? data.KdfMemory ?? 64,
      kdfParallelism: data.kdfParallelism ?? data.KdfParallelism ?? 4,
    };
  }

  /**
   * Login with Personal API Key (bypasses CAPTCHA & 2FA)
   * client_id format: "user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   */
  async loginWithApiKey(clientId, clientSecret) {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'api',
      deviceType: '9',
      deviceIdentifier: crypto.randomUUID(),
      deviceName: 'Bitwarden Dedup Tool',
    });

    const res = await fetch(`${this.identityUrl}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.ErrorModel?.Message || `API Key login failed: ${res.status}`);
    }

    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;

    return {
      accessToken: data.access_token,
      encryptedKey: data.Key ?? data.key,
      encryptedPrivateKey: data.PrivateKey ?? data.privateKey,
      // KDF params from login response (more reliable than prelogin!)
      kdfConfig: {
        kdf: data.Kdf ?? data.kdf ?? 0,
        kdfIterations: data.KdfIterations ?? data.kdfIterations ?? 600000,
        kdfMemory: (data.KdfMemory ?? data.kdfMemory ?? 64),
        kdfParallelism: (data.KdfParallelism ?? data.kdfParallelism ?? 4),
      },
    };
  }

  /**
   * Login with master password (may trigger CAPTCHA)
   */
  async loginWithPassword(email, hashedPassword, twoFactorToken = null, captchaResponse = null) {
    const body = new URLSearchParams({
      grant_type: 'password',
      username: email,
      password: hashedPassword,
      scope: 'api offline_access',
      client_id: 'web',
      deviceType: '9',
      deviceIdentifier: crypto.randomUUID(),
      deviceName: 'Bitwarden Dedup Tool',
    });

    if (twoFactorToken) {
      body.set('twoFactorToken', twoFactorToken);
      body.set('twoFactorProvider', '1');
      body.set('twoFactorRemember', '0');
    }
    if (captchaResponse) {
      body.set('captchaResponse', captchaResponse);
    }

    const res = await fetch(`${this.identityUrl}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      // Check for CAPTCHA requirement
      if (data.HCaptcha_SiteKey) {
        throw {
          type: 'captcha_required',
          siteKey: data.HCaptcha_SiteKey,
          message: '需要验证码。请改用 API Key 登录方式（推荐）。',
        };
      }
      // Check for 2FA requirement
      if (data.TwoFactorProviders2 || data.error_description?.includes('Two factor')) {
        throw { type: '2fa_required', providers: data.TwoFactorProviders2 };
      }
      throw new Error(data.error_description || data.ErrorModel?.Message || `Login failed: ${res.status}`);
    }

    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;

    return {
      accessToken: data.access_token,
      encryptedKey: data.Key ?? data.key,
      encryptedPrivateKey: data.PrivateKey ?? data.privateKey,
    };
  }

  /**
   * Sync: fetch entire vault (encrypted)
   */
  async sync() {
    const res = await this._authedFetch(`${this.apiUrl}/sync`);
    if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
    const data = await res.json();
    
    // Normalize response keys: Bitwarden API returns camelCase, 
    // but our code expects PascalCase throughout
    const ciphers = (data.Ciphers || data.ciphers || []).map(c => ({
      _original: c, // Preserve full original API response for updateCipher
      Id: c.Id || c.id,
      Type: c.Type ?? c.type,
      Name: c.Name || c.name,
      Notes: c.Notes || c.notes,
      FolderId: c.FolderId || c.folderId,
      Favorite: c.Favorite ?? c.favorite ?? false,
      Reprompt: c.Reprompt ?? c.reprompt ?? 0,
      OrganizationId: c.OrganizationId || c.organizationId || null,
      CollectionIds: c.CollectionIds || c.collectionIds || [],
      RevisionDate: c.RevisionDate || c.revisionDate,
      CreationDate: c.CreationDate || c.creationDate,
      DeletedDate: c.DeletedDate || c.deletedDate || null,
      Login: c.Login || c.login ? {
        Username: (c.Login || c.login)?.Username || (c.Login || c.login)?.username,
        Password: (c.Login || c.login)?.Password || (c.Login || c.login)?.password,
        PasswordRevisionDate: (c.Login || c.login)?.PasswordRevisionDate || (c.Login || c.login)?.passwordRevisionDate,
        Totp: (c.Login || c.login)?.Totp || (c.Login || c.login)?.totp,
        Uris: ((c.Login || c.login)?.Uris || (c.Login || c.login)?.uris || []).map(u => ({
          Uri: u.Uri || u.uri,
          Match: u.Match ?? u.match,
        })),
        Fido2Credentials: (c.Login || c.login)?.Fido2Credentials || (c.Login || c.login)?.fido2Credentials || [],
      } : null,
      Card: c.Card || c.card,
      Identity: c.Identity || c.identity,
      SecureNote: c.SecureNote || c.secureNote,
      SshKey: c.SshKey || c.sshKey || null,
      Fields: c.Fields || c.fields || [],
      PasswordHistory: c.PasswordHistory || c.passwordHistory || [],
      Key: c.Key || c.key || null,
    }));

    // Separate active and trashed items
    const activeCiphers = ciphers.filter(c => !c.DeletedDate);
    const trashedCiphers = ciphers.filter(c => !!c.DeletedDate);

    const folders = (data.Folders || data.folders || []).map(f => ({
      Id: f.Id || f.id,
      Name: f.Name || f.name,
      RevisionDate: f.RevisionDate || f.revisionDate,
    }));

    return { Ciphers: activeCiphers, Trash: trashedCiphers, Folders: folders };
  }

  /**
   * Get a single cipher by ID
   */
  async getCipher(id) {
    const res = await this._authedFetch(`${this.apiUrl}/ciphers/${id}`);
    if (!res.ok) throw new Error(`Get cipher failed: ${res.status}`);
    return res.json();
  }

  /**
   * Update a cipher (for merging passkeys)
   * Uses GET-then-PUT approach: fetches the current cipher first to ensure
   * all required fields (especially Key for per-cipher encryption) are present.
   */
  async updateCipher(id, cipherData) {
    const src = cipherData;

    // Step 1: GET the current cipher from the API to get all required fields
    let current = null;
    try {
      const getRes = await this._authedFetch(`${this.apiUrl}/ciphers/${id}`);
      if (getRes.ok) {
        current = await getRes.json();
        console.log(`[updateCipher] GET /ciphers/${id} OK, has key:`, !!(current.key || current.Key));
      }
    } catch (e) {
      console.warn(`[updateCipher] GET /ciphers/${id} failed, using source data:`, e.message);
    }

    // Step 2: Build payload starting from the current (fresh) data, overriding with our changes
    const base = current || src;
    const payload = {};

    // Copy ALL fields from the fresh GET response (this includes Key, etc.)
    if (current) {
      Object.assign(payload, current);
    }

    // Remove response-only fields that must not be in PUT body
    const removeKeys = [
      'id', 'Id', 'object', 'Object',
      'edit', 'Edit', 'viewPassword', 'ViewPassword',
      'permissions', 'Permissions',
      'archivedDate', 'ArchivedDate',
      'attachments', 'Attachments',
      'passwordHistory', 'PasswordHistory',
      'collectionIds', 'CollectionIds',
      'deletedDate', 'DeletedDate',
      'data', 'Data',
      'sizeName', 'SizeName',
    ];
    for (const key of removeKeys) {
      delete payload[key];
    }

    // Set LastKnownRevisionDate from fresh data
    const revDate = base.RevisionDate || base.revisionDate || base.LastKnownRevisionDate;
    payload.LastKnownRevisionDate = revDate || new Date().toISOString();
    delete payload.revisionDate;
    delete payload.RevisionDate;
    delete payload.creationDate;
    delete payload.CreationDate;

    // Override with our merged data (the actual modifications we want to make)
    payload.Type = src.Type ?? src.type ?? payload.Type ?? payload.type;
    payload.OrganizationId = src.OrganizationId || src.organizationId || payload.OrganizationId || payload.organizationId || null;
    payload.FolderId = 'FolderId' in src ? src.FolderId : ('folderId' in src ? src.folderId : (payload.FolderId || payload.folderId || null));
    payload.Name = src.Name || src.name || payload.Name || payload.name;
    payload.Notes = 'Notes' in src ? src.Notes : ('notes' in src ? src.notes : (payload.Notes || payload.notes || null));
    payload.Favorite = src.Favorite ?? src.favorite ?? payload.Favorite ?? payload.favorite ?? false;
    payload.Reprompt = src.Reprompt ?? src.reprompt ?? payload.Reprompt ?? payload.reprompt ?? 0;
    payload.Fields = src.Fields || src.fields || payload.Fields || payload.fields || [];

    // Ensure Key is present (critical for per-cipher encryption)
    const keyVal = src.Key || src.key || (current && (current.Key || current.key)) || null;
    if (keyVal) {
      payload.Key = keyVal;
    }
    // Clean up lowercase duplicates
    delete payload.type;
    delete payload.organizationId;
    delete payload.folderId;
    delete payload.name;
    delete payload.notes;
    delete payload.favorite;
    delete payload.reprompt;
    delete payload.fields;
    delete payload.key;

    // Login-type fields (apply our merged Login data)
    const srcLogin = src.Login || src.login;
    if (srcLogin) {
      payload.Login = {
        Username: srcLogin.Username ?? srcLogin.username ?? null,
        Password: srcLogin.Password ?? srcLogin.password ?? null,
        PasswordRevisionDate: srcLogin.PasswordRevisionDate || srcLogin.passwordRevisionDate || null,
        Totp: srcLogin.Totp ?? srcLogin.totp ?? null,
        Uris: (srcLogin.Uris || srcLogin.uris || []).map(u => ({
          Uri: u.Uri || u.uri || null,
          Match: u.Match ?? u.match ?? null,
          UriChecksum: u.UriChecksum || u.uriChecksum || null,
        })),
        Fido2Credentials: srcLogin.Fido2Credentials || srcLogin.fido2Credentials || [],
      };
      delete payload.login;
    }

    // Card/Identity/SecureNote/SshKey (pass-through)
    if (src.Card || src.card) { payload.Card = src.Card || src.card; delete payload.card; }
    if (src.Identity || src.identity) { payload.Identity = src.Identity || src.identity; delete payload.identity; }
    if (src.SecureNote || src.secureNote) { payload.SecureNote = src.SecureNote || src.secureNote; delete payload.secureNote; }
    if (src.SshKey || src.sshKey) { payload.SshKey = src.SshKey || src.sshKey; delete payload.sshKey; }

    console.log(`[updateCipher] PUT /ciphers/${id} Key=${!!payload.Key}`, JSON.stringify(payload).substring(0, 1500));

    const res = await this._authedFetch(`${this.apiUrl}/ciphers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[updateCipher] FAILED for ${id}:`, JSON.stringify(err));
      throw new Error(`Update cipher failed: ${res.status} - ${err.Message || JSON.stringify(err)}`);
    }
    return res.json();
  }

  /**
   * Create a new cipher (for merge: create-then-delete strategy)
   * Accepts a fully constructed CipherRequest payload (camelCase, encrypted fields)
   */
  async createCipher(cipherPayload) {
    console.log('[createCipher] POST /ciphers', JSON.stringify(cipherPayload).substring(0, 1500));
    const res = await this._authedFetch(`${this.apiUrl}/ciphers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cipherPayload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[createCipher] FAILED:', JSON.stringify(err));
      throw new Error(`Create cipher failed: ${res.status} - ${err.Message || err.message || JSON.stringify(err)}`);
    }
    const result = await res.json();
    console.log('[createCipher] SUCCESS, new id:', result.id || result.Id);
    return result;
  }

  /**
   * Soft-delete ciphers in bulk (moves to trash)
   */
  async softDeleteBulk(ids) {
    const res = await this._authedFetch(`${this.apiUrl}/ciphers/delete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error(`Bulk delete failed: ${res.status}`);
  }

  /**
   * Create a new folder
   * @param {string} encryptedName - The encrypted folder name (CipherString)
   */
  async createFolder(encryptedName) {
    const res = await this._authedFetch(`${this.apiUrl}/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: encryptedName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Create folder failed: ${res.status} - ${err.Message || ''}`);
    }
    return res.json();
  }

  /**
   * Update (rename) a folder
   * @param {string} id - Folder ID
   * @param {string} encryptedName - The new encrypted folder name
   */
  async updateFolder(id, encryptedName) {
    const res = await this._authedFetch(`${this.apiUrl}/folders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: encryptedName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Update folder failed: ${res.status} - ${err.Message || ''}`);
    }
    return res.json();
  }

  /**
   * Delete a folder
   * @param {string} id - Folder ID
   */
  async deleteFolder(id) {
    const res = await this._authedFetch(`${this.apiUrl}/folders/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Delete folder failed: ${res.status}`);
  }

  /**
   * Bulk move ciphers to a folder (or remove from folder with null)
   */
  async bulkMoveCiphersToFolder(ids, folderId) {
    const res = await this._authedFetch(`${this.apiUrl}/ciphers/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, folderId }),
    });
    if (!res.ok) throw new Error(`Bulk move failed: ${res.status}`);
  }

  /**
   * Restore ciphers from trash (bulk)
   */
  async restoreBulk(ids) {
    const res = await this._authedFetch(`${this.apiUrl}/ciphers/restore`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error(`Bulk restore failed: ${res.status}`);
  }

  /**
   * Permanently delete ciphers (bulk) — irreversible!
   */
  async permanentDeleteBulk(ids) {
    const res = await this._authedFetch(`${this.apiUrl}/ciphers/delete-admin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    // Try alternative endpoint if admin fails
    if (!res.ok) {
      const res2 = await this._authedFetch(`${this.apiUrl}/ciphers/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res2.ok) throw new Error(`Permanent delete failed: ${res2.status}`);
    }
  }

  /**
   * Export vault as encrypted JSON (for merge fallback)
   */
  async exportVault() {
    const res = await this._authedFetch(`${this.apiUrl}/ciphers`, {
      method: 'GET',
    });
    if (!res.ok) {
      throw new Error(`Export vault failed: ${res.status}`);
    }
    return res.json(); // { data: [...ciphers] }
  }

  /**
   * Import ciphers (for merge fallback)
   * @param {Object} importData - { ciphers: [...], folders: [...], folderRelationships: [...] }
   */
  async importCiphers(importData) {
    const res = await this._authedFetch(`${this.apiUrl}/ciphers/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Import ciphers failed: ${res.status} - ${err.Message || JSON.stringify(err)}`);
    }
  }

  async _authedFetch(url, options = {}) {
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const headers = {
        ...options.headers,
        Authorization: `Bearer ${this.accessToken}`,
      };
      try {
        const res = await fetch(url, { ...options, headers });
        // 4xx = business error, don't retry; 2xx/3xx = success
        if (res.ok || res.status < 500) return res;
        // 5xx = server error, retry unless last attempt
        if (attempt === maxRetries) return res;
      } catch (err) {
        // Network error (offline, DNS, timeout) — retry unless last attempt
        if (attempt === maxRetries) throw err;
      }
      // Exponential backoff: 1s → 2s → 4s + random jitter (0-500ms)
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      const jitter = Math.random() * 500;
      await new Promise(r => setTimeout(r, delay + jitter));
    }
  }
}
