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

    const base = current || src;
    const g = (obj, ...keys) => { for (const k of keys) { if (obj && obj[k] != null) return obj[k]; } return null; };

    // Step 2: Build a clean camelCase payload matching official Bitwarden CipherRequest spec
    const revDate = g(base, 'RevisionDate', 'revisionDate', 'LastKnownRevisionDate', 'lastKnownRevisionDate');
    const payload = {
      type: g(src, 'Type', 'type') ?? g(base, 'Type', 'type'),
      organizationId: g(src, 'OrganizationId', 'organizationId') || g(base, 'OrganizationId', 'organizationId') || null,
      folderId: 'FolderId' in src ? src.FolderId : ('folderId' in src ? src.folderId : (g(base, 'FolderId', 'folderId') || null)),
      name: g(src, 'Name', 'name') || g(base, 'Name', 'name'),
      notes: 'Notes' in src ? src.Notes : ('notes' in src ? src.notes : (g(base, 'Notes', 'notes') || null)),
      favorite: (src.Favorite ?? src.favorite ?? g(base, 'Favorite', 'favorite')) ?? false,
      reprompt: (src.Reprompt ?? src.reprompt ?? g(base, 'Reprompt', 'reprompt')) ?? 0,
      lastKnownRevisionDate: revDate || new Date().toISOString(),
    };

    // Key (critical for per-cipher encryption items)
    const keyVal = g(src, 'Key', 'key') || (current && g(current, 'Key', 'key')) || null;
    if (keyVal) {
      payload.key = keyVal;
    }

    // Fields
    const srcFields = g(src, 'Fields', 'fields') || g(base, 'Fields', 'fields') || [];
    payload.fields = srcFields.map(f => ({
      type: f.Type ?? f.type ?? 0,
      name: f.Name || f.name || null,
      value: f.Value || f.value || null,
      linkedId: f.LinkedId ?? f.linkedId ?? null,
    }));

    // Password history
    const srcPH = g(src, 'PasswordHistory', 'passwordHistory') || g(base, 'PasswordHistory', 'passwordHistory') || null;
    payload.passwordHistory = srcPH ? srcPH.map(ph => ({
      lastUsedDate: ph.LastUsedDate || ph.lastUsedDate || null,
      password: ph.Password || ph.password || null,
    })) : null;

    // Login
    const srcLogin = g(src, 'Login', 'login');
    if (srcLogin) {
      const freshLogin = current ? g(current, 'Login', 'login') || {} : {};
      // Merge: start from fresh, override with our changes
      const login = {};
      login.username = g(srcLogin, 'Username', 'username') ?? g(freshLogin, 'Username', 'username') ?? null;
      login.password = g(srcLogin, 'Password', 'password') ?? g(freshLogin, 'Password', 'password') ?? null;
      login.passwordRevisionDate = g(srcLogin, 'PasswordRevisionDate', 'passwordRevisionDate') || g(freshLogin, 'PasswordRevisionDate', 'passwordRevisionDate') || null;
      login.totp = g(srcLogin, 'Totp', 'totp') ?? g(freshLogin, 'Totp', 'totp') ?? null;
      login.autofillOnPageLoad = g(srcLogin, 'AutofillOnPageLoad', 'autofillOnPageLoad') ?? g(freshLogin, 'AutofillOnPageLoad', 'autofillOnPageLoad') ?? null;

      // URIs
      const srcUris = g(srcLogin, 'Uris', 'uris') || g(freshLogin, 'Uris', 'uris') || [];
      login.uris = srcUris.map(u => {
        const uriObj = {
          uri: g(u, 'Uri', 'uri') || null,
          match: u.Match ?? u.match ?? null,
        };
        // Preserve uriChecksum for unchanged URIs
        const checksum = g(u, 'UriChecksum', 'uriChecksum');
        if (checksum) {
          uriObj.uriChecksum = checksum;
        }
        return uriObj;
      });

      // Fido2 credentials — preserve from fresh GET, override if src has them
      const fido2 = g(srcLogin, 'Fido2Credentials', 'fido2Credentials') || g(freshLogin, 'Fido2Credentials', 'fido2Credentials') || null;
      if (fido2) {
        login.fido2Credentials = fido2.map(k => ({
          credentialId: g(k, 'CredentialId', 'credentialId') || null,
          keyType: g(k, 'KeyType', 'keyType') || null,
          keyAlgorithm: g(k, 'KeyAlgorithm', 'keyAlgorithm') || null,
          keyCurve: g(k, 'KeyCurve', 'keyCurve') || null,
          keyValue: g(k, 'KeyValue', 'keyValue') || null,
          rpId: g(k, 'RpId', 'rpId') || null,
          rpName: g(k, 'RpName', 'rpName') || null,
          counter: g(k, 'Counter', 'counter') || null,
          userHandle: g(k, 'UserHandle', 'userHandle') || null,
          userName: g(k, 'UserName', 'userName') || null,
          userDisplayName: g(k, 'UserDisplayName', 'userDisplayName') || null,
          discoverable: g(k, 'Discoverable', 'discoverable') || null,
          creationDate: g(k, 'CreationDate', 'creationDate') || null,
        }));
      }

      payload.login = login;
    }

    // Card
    const srcCard = g(src, 'Card', 'card');
    if (srcCard) {
      const freshCard = current ? g(current, 'Card', 'card') || {} : {};
      const merged = { ...freshCard, ...srcCard };
      payload.card = {
        cardholderName: g(merged, 'CardholderName', 'cardholderName') || null,
        brand: g(merged, 'Brand', 'brand') || null,
        number: g(merged, 'Number', 'number') || null,
        expMonth: g(merged, 'ExpMonth', 'expMonth') || null,
        expYear: g(merged, 'ExpYear', 'expYear') || null,
        code: g(merged, 'Code', 'code') || null,
      };
    } else {
      payload.card = null;
    }

    // Identity
    const srcId = g(src, 'Identity', 'identity');
    if (srcId) {
      const freshId = current ? g(current, 'Identity', 'identity') || {} : {};
      const merged = { ...freshId, ...srcId };
      const idFields = ['title','firstName','middleName','lastName','address1','address2','address3','city','state','postalCode','country','company','email','phone','ssn','username','passportNumber','licenseNumber'];
      payload.identity = {};
      for (const f of idFields) {
        const upper = f.charAt(0).toUpperCase() + f.slice(1);
        payload.identity[f] = g(merged, upper, f) || null;
      }
    } else {
      payload.identity = null;
    }

    // SecureNote
    const srcSN = g(src, 'SecureNote', 'secureNote');
    if (srcSN) {
      payload.secureNote = { type: srcSN.Type ?? srcSN.type ?? 0 };
    } else {
      payload.secureNote = null;
    }

    // SshKey
    const srcSsh = g(src, 'SshKey', 'sshKey');
    if (srcSsh) {
      const freshSsh = current ? g(current, 'SshKey', 'sshKey') || {} : {};
      const merged = { ...freshSsh, ...srcSsh };
      payload.sshKey = {
        privateKey: g(merged, 'PrivateKey', 'privateKey') || null,
        publicKey: g(merged, 'PublicKey', 'publicKey') || null,
        keyFingerprint: g(merged, 'KeyFingerprint', 'keyFingerprint') || null,
      };
    } else {
      payload.sshKey = null;
    }

    console.log(`[updateCipher] PUT /ciphers/${id} key=${!!payload.key}`, JSON.stringify(payload).substring(0, 2000));

    const res = await this._authedFetch(`${this.apiUrl}/ciphers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[updateCipher] FAILED for ${id}:`, JSON.stringify(err));
      throw new Error(`Update cipher failed: ${res.status} - ${err.message || err.Message || JSON.stringify(err)}`);
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
