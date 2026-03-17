import { BitwardenClient } from './bitwarden-api.js';
import { makeMasterKey, stretchKey, decryptSymmetricKey, decryptToString, encryptString } from './crypto.js';
import { analyzeCiphers, buildMergeOperations } from './dedup-engine.js';
import { searchAndFilter, QUICK_FILTERS, getFilterCounts, SORT_OPTIONS } from './search-engine.js';
import { analyzeHealth } from './health-engine.js';
import { generateDemoData } from './demo-data.js';
import { t, getLocale, setLocale, initLocale } from './i18n.js';
import { getTheme, setTheme, toggleTheme, initTheme } from './theme.js';
import { saveAs } from 'file-saver';
import './style.css';

// --- State ---
let client = null;
let symmetricKey = null;
let vaultData = null;
let allDecryptedCiphers = [];
let allDecryptedTrash = [];
let analysisResult = null;
let healthResult = null;
let folderMap = {};
let folderList = []; // { id, name } sorted
let currentAuthMode = 'apikey';
let currentView = 'overview';
let selectedFolderId = null; // for folder view filtering
let activeFilters = new Set();
let searchQuery = '';
let sortId = 'name-asc';
let selectedItems = new Set();
let isDemoMode = false;
let isMergeLocked = false; // Lock to prevent concurrent merge operations
let deadUrlItems = []; // Items whose URLs failed liveness check
let deadUrlCheckDone = false; // Whether the check has completed

// --- DOM ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ========================
// SESSION PERSISTENCE
// ========================
const SESSION_KEY = 'bw_session';

function _u8ToB64(u8) {
  return btoa(String.fromCharCode(...u8));
}
function _b64ToU8(b64) {
  const bin = atob(b64);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

function saveSession(serverUrl, accessToken, symKey) {
  try {
    const payload = {
      serverUrl,
      accessToken,
      encKey: _u8ToB64(symKey.encKey),
      macKey: _u8ToB64(symKey.macKey),
      savedAt: Date.now(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('[Session] Failed to save:', e);
  }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Session older than 1 hour? → still valid, Bitwarden tokens last longer
    // We'll let the API call fail naturally if expired
    return {
      serverUrl: data.serverUrl || '',
      accessToken: data.accessToken,
      encKey: _b64ToU8(data.encKey),
      macKey: _b64ToU8(data.macKey),
    };
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

async function tryRestoreSession() {
  const saved = loadSession();
  if (!saved) return false;

  try {
    // Restore client with saved access token
    client = new BitwardenClient(saved.serverUrl);
    client.accessToken = saved.accessToken;

    // Restore symmetric key
    symmetricKey = { encKey: saved.encKey, macKey: saved.macKey };

    // Try syncing — if token expired, this will throw
    setLoginState('loading', t('status.restoring'));
    vaultData = await client.sync();

    setLoginState('loading', t('status.decrypt.analyze'));
    allDecryptedCiphers = await decryptAllCiphers(vaultData);
    allDecryptedTrash = await decryptAllCiphers({ Ciphers: vaultData.Trash || [] });
    analysisResult = analyzeCiphers(allDecryptedCiphers);
    healthResult = analyzeHealth(allDecryptedCiphers);

    folderMap = {};
    if (vaultData.Folders) {
      for (const f of vaultData.Folders) {
        try {
          folderMap[f.Id] = await decryptToString(f.Name, symmetricKey) || t('item.unnamed.folder');
        } catch {
          folderMap[f.Id] = t('item.decrypt.fail');
        }
      }
    }

    enterDashboard();
    showToast(t('toast.session.restored'), 'success');
    return true;
  } catch (err) {
    console.warn('[Session] Restore failed, clearing:', err.message);
    clearSession();
    client = null;
    symmetricKey = null;
    setLoginState('idle', '');
    return false;
  }
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize i18n and theme BEFORE anything else
  initLocale();
  initTheme();
  updateControlButtons();

  setupAuthModeTabs();
  setupLoginForm();
  setupCredFileImport();
  setupKeyboardShortcuts();

  // Network awareness
  window.addEventListener('offline', () => {
    if (!isDemoMode) showToast(t('toast.network.lost'), 'warning');
  });
  window.addEventListener('online', () => {
    if (!isDemoMode) {
      showToast(t('toast.network.back'), 'success');
      if (client && symmetricKey) resyncVault();
    }
  });

  // Demo mode button
  $('#demo-btn')?.addEventListener('click', enterDemoMode);

  // Language toggle buttons (login + dashboard)
  $('#lang-toggle-login')?.addEventListener('click', () => {
    setLocale(getLocale() === 'zh' ? 'en' : 'zh');
    updateControlButtons();
  });
  $('#lang-toggle-dash')?.addEventListener('click', () => {
    setLocale(getLocale() === 'zh' ? 'en' : 'zh');
    updateControlButtons();
  });

  // Theme toggle buttons (login + dashboard)
  $('#theme-toggle-login')?.addEventListener('click', () => {
    toggleTheme();
    updateControlButtons();
  });
  $('#theme-toggle-dash')?.addEventListener('click', () => {
    toggleTheme();
    updateControlButtons();
  });

  // When locale changes, refresh dynamic content
  window.addEventListener('localeChanged', () => {
    if (isDemoMode) {
      // Re-generate demo data in new locale
      const demo = generateDemoData(getLocale());
      allDecryptedCiphers = demo.ciphers;
      allDecryptedTrash = demo.trash;
      // Rebuild folderMap from new locale folders
      folderMap = {};
      demo.folders.forEach(f => { folderMap[f.id] = f.name; });
      analysisResult = analyzeCiphers(allDecryptedCiphers);
      healthResult = analyzeHealth(allDecryptedCiphers);
      // Update demo banner text
      const banner = document.querySelector('.demo-banner');
      if (banner) {
        banner.innerHTML = `${t('demo.banner')}<br><small>${t('demo.banner.sub')}</small>`;
      }
    }
    // Refresh the current view
    if ($('#dashboard-view').style.display !== 'none') {
      updateSidebarBadges();
      renderFolderList();
      switchView(currentView);
    }
  });

  // Try to restore previous session (avoid re-login)
  await tryRestoreSession();
});

function updateControlButtons() {
  const locale = getLocale();
  const theme = getTheme();
  // Language labels
  const langText = locale === 'zh' ? 'EN' : '中';
  const el1 = $('#lang-label-login');
  const el2 = $('#lang-label-dash');
  if (el1) el1.textContent = langText;
  if (el2) el2.textContent = langText;
  // Theme icons
  const themeIcon = theme === 'dark' ? '☀️' : '🌙';
  const ti1 = $('#theme-icon-login');
  const ti2 = $('#theme-icon-dash');
  if (ti1) ti1.textContent = themeIcon;
  if (ti2) ti2.textContent = themeIcon;
}

// ========================
// AUTH MODE TOGGLE
// ========================
function setupAuthModeTabs() {
  $$('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentAuthMode = tab.dataset.mode;
      $$('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.auth-panel').forEach(p => p.classList.remove('active'));
      $(`#auth-${currentAuthMode}`).classList.add('active');
      setLoginState('idle', '');
    });
  });
}

// ========================
// LOGIN
// ========================
function setupLoginForm() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (currentAuthMode === 'apikey') {
      await handleApiKeyLogin();
    }
    // credfile mode is handled by its own event listener
  });
}

async function handleApiKeyLogin() {
  const clientId = $('#client-id').value.trim();
  const clientSecret = $('#client-secret').value.trim();
  const email = $('#api-email').value.trim();
  const password = $('#api-password').value;
  const serverUrl = $('#server-url').value;

  if (!clientId || !clientSecret || !email || !password) {
    setLoginState('error', t('status.fill.all'));
    return;
  }

  setLoginState('loading', t('status.connecting'));

  try {
    client = new BitwardenClient(serverUrl);

    setLoginState('loading', t('status.apikey.login'));
    const loginResult = await client.loginWithApiKey(clientId, clientSecret);

    const kdfConfig = loginResult.kdfConfig;
    setLoginState('loading', `${t('status.kdf')} (${kdfConfig.kdfIterations} ${t('status.kdf.rounds')})...`);
    const masterKey = await makeMasterKey(password, email, kdfConfig);
    const stretched = await stretchKey(masterKey);

    setLoginState('loading', t('status.decrypt.key'));
    symmetricKey = await decryptSymmetricKey(loginResult.encryptedKey, stretched);

    setLoginState('loading', t('status.sync'));
    vaultData = await client.sync();

    setLoginState('loading', t('status.decrypt.analyze'));
    allDecryptedCiphers = await decryptAllCiphers(vaultData);
    analysisResult = analyzeCiphers(allDecryptedCiphers);
    healthResult = analyzeHealth(allDecryptedCiphers);

    folderMap = {};
    if (vaultData.Folders) {
      for (const f of vaultData.Folders) {
        try {
          folderMap[f.Id] = await decryptToString(f.Name, symmetricKey) || t('item.unnamed.folder');
        } catch {
          folderMap[f.Id] = t('item.decrypt.fail');
        }
      }
    }

    // Save session for persistence
    saveSession(serverUrl, client.accessToken, symmetricKey);

    enterDashboard();
  } catch (err) {
    console.error('API Key login error:', err);
    setLoginState('error', err.message || t('status.login.fail'));
  }
}

function setLoginState(state, message) {
  const statusEl = $('#login-status');
  const submitBtn = $('#login-btn');
  statusEl.textContent = message;
  statusEl.className = `login-status ${state}`;
  if (state === 'loading') {
    submitBtn.disabled = true;
    submitBtn.textContent = t('modal.processing');
  } else {
    submitBtn.disabled = false;
    submitBtn.textContent = t('login.btn');
  }
}

// ========================
// DASHBOARD ENTRY
// ========================
function enterDashboard() {
  $('#login-view').style.display = 'none';
  $('#dashboard-view').style.display = 'block';

  setupSidebarNav();
  setupSearch();
  setupFilterTags();
  setupBatchOps();
  setupDetailDrawer();
  setupFolderManagement();
  setupSyncButton();
  setupLogout();

  // Demo mode banner
  if (isDemoMode) {
    const sidebar = $('#sidebar');
    if (sidebar && !sidebar.querySelector('.demo-banner')) {
      const banner = document.createElement('div');
      banner.className = 'demo-banner';
      banner.innerHTML = `${t('demo.banner')}<br><small>${t('demo.banner.sub')}</small>`;
      sidebar.querySelector('.sidebar-header')?.after(banner);
    }
  }

  updateSidebarBadges();
  renderFolderList();
  switchView('overview');

  // Start async URL liveness check in the background
  checkDeadUrls();
}

/**
 * Enter demo mode — generate fake data, skip all API calls
 */
function enterDemoMode() {
  isDemoMode = true;
  const demo = generateDemoData(getLocale());

  // Build demo client stub (all methods are no-ops that return instantly)
  client = {
    sync: async () => ({ Ciphers: demo.ciphers.map(c => c.raw), Trash: demo.trash.map(c => c.raw), Folders: demo.folders.map(f => ({ Id: f.id, Name: f.name })) }),
    updateCipher: async () => {},
    softDeleteBulk: async () => {},
    permanentDeleteBulk: async () => {},
    restoreBulk: async () => {},
    bulkMoveCiphersToFolder: async () => {},
    createFolder: async (name) => ({ Id: 'folder-' + Date.now(), Name: name }),
    renameFolder: async () => {},
    deleteFolder: async () => {},
    createCipher: async (data) => ({ ...data, Id: 'cipher-' + Date.now() }),
    importCiphers: async () => {},
    getCipher: async (id) => {
      const item = allDecryptedCiphers.find(c => c.id === id);
      return item?.raw || {};
    },
  };

  // Set data directly (plaintext, no decryption needed)
  allDecryptedCiphers = demo.ciphers;
  allDecryptedTrash = demo.trash;
  folderMap = {};
  demo.folders.forEach(f => { folderMap[f.id] = f.name; });
  analysisResult = analyzeCiphers(allDecryptedCiphers);
  healthResult = analyzeHealth(allDecryptedCiphers);

  // Override symmetric key with a dummy so encrypt/decrypt functions don't crash
  // In demo mode we intercept operations before they need real crypto
  symmetricKey = { encKey: new Uint8Array(32), macKey: new Uint8Array(32) };

  enterDashboard();
}

function updateSidebarBadges() {
  const stats = analysisResult.stats;
  $('#badge-all').textContent = stats.totalItems;
  const dupCount = stats.exactDuplicateGroups + stats.sameSiteDuplicateGroups;
  $('#badge-dup').textContent = dupCount > 0 ? dupCount : '';
  $('#badge-orphan').textContent = stats.orphanItems;
  const noFolderCount = allDecryptedCiphers.filter(c => !c.raw?.FolderId).length;
  $('#badge-nofolder').textContent = noFolderCount > 0 ? noFolderCount : '';
  const issueCount = healthResult.issues.reduce((s, i) => s + i.count, 0);
  $('#badge-health').textContent = issueCount > 0 ? issueCount : '';
  if (issueCount > 0) $('#badge-health').classList.add('danger');
  const trashBadge = $('#badge-trash');
  if (trashBadge) trashBadge.textContent = allDecryptedTrash.length > 0 ? allDecryptedTrash.length : '';
  // Corrupted badge
  const corruptedCount = allDecryptedCiphers.filter(c => c.decrypted?.error || !c.decrypted?.name).length;
  const corruptedBadge = $('#badge-corrupted');
  if (corruptedBadge) corruptedBadge.textContent = corruptedCount > 0 ? corruptedCount : '';
  // Dead URL badge
  const deadBadge = $('#badge-dead-urls');
  if (deadBadge) {
    if (deadUrlCheckDone) {
      deadBadge.textContent = deadUrlItems.length > 0 ? deadUrlItems.length : '';
      if (deadUrlItems.length > 0) deadBadge.classList.add('warn');
    } else {
      deadBadge.textContent = '…';
    }
  }
  // Special type badges
  const typeMap = { 'type-card': 3, 'type-identity': 4, 'type-note': 2, 'type-sshkey': 5 };
  for (const [viewName, typeId] of Object.entries(typeMap)) {
    const count = allDecryptedCiphers.filter(c => (c.raw?.Type ?? c.raw?.type) === typeId).length;
    const badge = $(`#badge-${viewName}`);
    if (badge) badge.textContent = count > 0 ? count : '';
  }
}

// ========================
// SIDEBAR NAVIGATION
// ========================
function setupSidebarNav() {
  $$('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      switchView(item.dataset.view);
    });
  });
}

function switchView(view) {
  currentView = view;

  // Update nav active states
  $$('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
  $(`.nav-item[data-view="${view}"]`)?.classList.add('active');

  // Also highlight folder item if folder view
  $$('.folder-item').forEach(f => f.classList.remove('active'));
  if (view === 'folder' && selectedFolderId) {
    $(`.folder-item[data-folder-id="${selectedFolderId}"]`)?.classList.add('active');
  }

  // Hide all views, show target
  $$('.content-view').forEach(v => v.classList.remove('active'));
  $(`#view-${view}`)?.classList.add('active');

  // Show/hide filter bar (only for 'all' and 'folder' views)
  const filterBar = $('#filter-bar');
  filterBar.style.display = (view === 'all' || view === 'folder') ? 'flex' : 'none';

  // Clear selection on view change
  selectedItems.clear();
  updateBatchBar();

  // Render the view
  switch (view) {
    case 'overview': renderOverview(); break;
    case 'all': renderAllItems(); break;
    case 'duplicates': renderDuplicatesView(); break;
    case 'orphans': renderOrphansView(); break;
    case 'nofolder': renderNoFolderView(); break;
    case 'health': renderHealthView(); break;
    case 'folder': renderFolderView(); break;
    case 'credfile': renderCredFileView(); break;
    case 'trash': renderTrashView(); break;
    case 'corrupted': renderCorruptedView(); break;
    case 'dead-urls': renderDeadUrlsView(); break;
    case 'type-card': renderTypeFilteredView('type-card', 3, '💳 支付卡'); break;
    case 'type-identity': renderTypeFilteredView('type-identity', 4, '🪪 身份'); break;
    case 'type-note': renderTypeFilteredView('type-note', 2, '📝 安全笔记'); break;
    case 'type-sshkey': renderTypeFilteredView('type-sshkey', 5, '🔑 SSH 密钥'); break;
  }
}

// ========================
// SEARCH
// ========================
function setupSearch() {
  const input = $('#global-search');
  let timeout;
  input.addEventListener('input', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      searchQuery = input.value;
      // Re-render whichever view is active
      switch (currentView) {
        case 'all': renderAllItems(); break;
        case 'duplicates': renderDuplicatesView(); break;
        case 'orphans': renderOrphansView(); break;
        case 'nofolder': renderNoFolderView(); break;
        case 'folder': renderFolderView(); break;
        case 'trash': renderTrashView(); break;
        case 'corrupted': renderCorruptedView(); break;
        case 'health': renderHealthView(); break;
        case 'dead-urls': renderDeadUrlsView(); break;
        case 'type-card': renderTypeFilteredView('type-card', 3, '💳 支付卡'); break;
        case 'type-identity': renderTypeFilteredView('type-identity', 4, '🪪 身份'); break;
        case 'type-note': renderTypeFilteredView('type-note', 2, '📝 安全笔记'); break;
        case 'type-sshkey': renderTypeFilteredView('type-sshkey', 5, '🔑 SSH 密钥'); break;
      }
    }, 200);
  });
}

/**
 * Check if a cipher matches the current search query
 */
function matchesSearch(item) {
  if (!searchQuery.trim()) return true;
  const q = searchQuery.toLowerCase().trim();
  const name = (item.decrypted?.name || '').toLowerCase();
  const username = (item.decrypted?.username || '').toLowerCase();
  const uris = (item.decrypted?.uris || []).join(' ').toLowerCase();
  return name.includes(q) || username.includes(q) || uris.includes(q);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // "/" to focus search
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      const search = $('#global-search');
      if (search && document.activeElement !== search) {
        e.preventDefault();
        search.focus();
      }
    }
    // Escape to close drawer/modal
    if (e.key === 'Escape') {
      closeDetailDrawer();
      closeModal();
    }
  });
}

// ========================
// FILTER TAGS
// ========================
function setupFilterTags() {
  const container = $('#filter-tags');
  const counts = getFilterCounts(allDecryptedCiphers);

  container.innerHTML = QUICK_FILTERS.map(f => `
    <button class="filter-tag" data-filter="${f.id}">
      ${f.icon} ${f.label}<span class="tag-count">${counts[f.id]}</span>
    </button>
  `).join('');

  container.addEventListener('click', (e) => {
    const tag = e.target.closest('.filter-tag');
    if (!tag) return;
    const filterId = tag.dataset.filter;
    if (activeFilters.has(filterId)) {
      activeFilters.delete(filterId);
      tag.classList.remove('active');
    } else {
      activeFilters.add(filterId);
      tag.classList.add('active');
    }
    renderAllItems();
  });

  // Sort select
  $('#sort-select').addEventListener('change', (e) => {
    sortId = e.target.value;
    renderAllItems();
  });
}

// ========================
// BATCH OPERATIONS
// ========================
function setupBatchOps() {
  $('#batch-cancel-btn').addEventListener('click', () => {
    selectedItems.clear();
    updateBatchBar();
    if (currentView === 'all') renderAllItems();
    else if (currentView === 'folder') renderFolderView();
    else if (currentView === 'orphans') renderOrphansView();
    else if (currentView === 'nofolder') renderNoFolderView();
    else if (currentView === 'trash') renderTrashView();
    else if (currentView.startsWith('type-')) {
      const tMap = { 'type-card': [3, '💳 支付卡'], 'type-identity': [4, '🪪 身份'], 'type-note': [2, '📝 安全笔记'], 'type-sshkey': [5, '🔑 SSH 密钥'] };
      const [tid, tlabel] = tMap[currentView] || [0, ''];
      renderTypeFilteredView(currentView, tid, tlabel);
    }
  });

  $('#batch-delete-btn').addEventListener('click', () => {
    if (selectedItems.size === 0) return;
    showConfirm(
      t('batch.delete.title'),
      `${t('modal.confirm')} ${selectedItems.size} ${t('batch.delete.msg')}`,
      async () => {
        try {
          const ids = Array.from(selectedItems);
          const deleteSet = new Set(ids);

          // Optimistic UI update — instantly remove from in-memory data
          allDecryptedCiphers = allDecryptedCiphers.filter(c => !deleteSet.has(c.id));
          analysisResult = analyzeCiphers(allDecryptedCiphers);
          healthResult = analyzeHealth(allDecryptedCiphers);
          selectedItems.clear();
          updateBatchBar();
          updateSidebarBadges();
          switchView(currentView);

          showToast(`✅ ${ids.length} ${t('dup.items')} ${t('detail.delete.trash')}`, 'success');

          // Server-side delete (background)
          for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            await client.softDeleteBulk(batch);
          }
          // Background resync to ensure consistency
          resyncVault();
        } catch (err) {
          showToast(`❌ ${t('detail.delete.fail')}: ${err.message}`, 'error');
          // Rollback: re-sync from server
          resyncVault();
        }
      }
    );
  });

  // Batch move to folder
  $('#batch-move-btn').addEventListener('click', () => {
    if (selectedItems.size === 0) return;
    showMoveFolderModal();
  });
}

function updateBatchBar() {
  const bar = $('#batch-bar');
  if (selectedItems.size > 0) {
    bar.style.display = 'flex';
    $('#batch-count').textContent = `☑ ${selectedItems.size} ${t('batch.selected')}`;
  } else {
    bar.style.display = 'none';
  }
}

// ========================
// FOLDER MANAGEMENT
// ========================
function setupFolderManagement() {
  // Add folder button
  $('#folder-add-btn').addEventListener('click', () => showFolderNameModal('create'));

  // Folder modal events
  $('#folder-modal-cancel').addEventListener('click', closeFolderModal);
  $('#move-folder-cancel').addEventListener('click', () => {
    $('#move-folder-modal').style.display = 'none';
  });
}

function renderFolderList() {
  // Build sorted folder list from folderMap
  folderList = Object.entries(folderMap)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const container = $('#folder-list');
  if (folderList.length === 0) {
    container.innerHTML = `<div class="folder-empty">${t('folder.empty')}</div>`;
    return;
  }

  // Count items per folder
  const folderCounts = {};
  for (const c of allDecryptedCiphers) {
    const fid = c.raw?.FolderId;
    if (fid) folderCounts[fid] = (folderCounts[fid] || 0) + 1;
  }

  container.innerHTML = folderList.map(f => `
    <div class="folder-item ${selectedFolderId === f.id && currentView === 'folder' ? 'active' : ''}" data-folder-id="${f.id}">
      <span class="folder-name">${escHtml(f.name)}</span>
      <span class="folder-count">${folderCounts[f.id] || 0}</span>
      <div class="folder-actions">
        <button class="folder-action-btn rename" data-folder-id="${f.id}" title="${t('folder.rename')}">✏️</button>
        <button class="folder-action-btn delete" data-folder-id="${f.id}" title="${t('folder.delete')}">🗑️</button>
      </div>
    </div>
  `).join('');

  // Click folder item to view
  container.querySelectorAll('.folder-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.folder-action-btn')) return;
      selectedFolderId = el.dataset.folderId;
      switchView('folder');
    });
  });

  // Rename buttons
  container.querySelectorAll('.folder-action-btn.rename').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showFolderNameModal('rename', btn.dataset.folderId);
    });
  });

  // Delete buttons
  container.querySelectorAll('.folder-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const folderId = btn.dataset.folderId;
      const folderName = folderMap[folderId] || '';
      const count = folderCounts[folderId] || 0;
      showConfirm(
        t('folder.delete.title'),
        `${t('folder.delete.msg1')}${folderName}${t('folder.delete.msg2')}${count}${t('folder.delete.msg3')}`,
        async () => {
          try {
            await client.deleteFolder(folderId);
            showToast(`✅ ${folderName} ${t('folder.deleted.ok')}`, 'success');
            if (selectedFolderId === folderId) {
              selectedFolderId = null;
              switchView('all');
            }
            await resyncVault();
          } catch (err) {
            showToast(`❌ ${t('toast.op.fail')}: ${err.message}`, 'error');
          }
        }
      );
    });
  });
}

function showFolderNameModal(mode, folderId = null) {
  const modal = $('#folder-modal');
  const input = $('#folder-name-input');
  const title = $('#folder-modal-title');
  const confirmBtn = $('#folder-modal-confirm');

  if (mode === 'create') {
    title.textContent = t('folder.new');
    input.value = '';
  } else {
    title.textContent = t('folder.rename.title');
    input.value = folderMap[folderId] || '';
  }

  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 50);

  const handleConfirm = async () => {
    const name = input.value.trim();
    if (!name) { showToast(t('folder.name.required'), 'error'); return; }

    confirmBtn.disabled = true;
    confirmBtn.textContent = t('modal.processing');

    try {
      const encName = isDemoMode ? name : await encryptString(name, symmetricKey);

      if (mode === 'create') {
        const result = await client.createFolder(encName);
        if (isDemoMode) folderMap[result.Id] = name;
        showToast(`✅ ${name} ${t('folder.created.ok')}`, 'success');
      } else {
        await client.updateFolder(folderId, encName);
        if (isDemoMode) folderMap[folderId] = name;
        showToast(`✅ ${t('folder.renamed.ok')} ${name}`, 'success');
      }

      closeFolderModal();
      await resyncVault();
    } catch (err) {
      showToast(`❌ ${t('toast.op.fail')}: ${err.message}`, 'error');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = t('modal.confirm');
    }
  };

  confirmBtn.onclick = handleConfirm;
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); } };
}

function closeFolderModal() {
  $('#folder-modal').style.display = 'none';
}

function showMoveFolderModal() {
  const modal = $('#move-folder-modal');
  const list = $('#move-folder-list');

  list.innerHTML = `
    <button class="move-folder-option" data-folder-id="__none__">
      <span>📂</span> <span>${t('folder.none')}</span>
    </button>
    ${folderList.map(f => `
      <button class="move-folder-option" data-folder-id="${f.id}">
        <span>📁</span> <span>${escHtml(f.name)}</span>
      </button>
    `).join('')}
  `;

  modal.style.display = 'flex';

  list.querySelectorAll('.move-folder-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetFolderId = btn.dataset.folderId;
      const realFolderId = targetFolderId === '__none__' ? null : targetFolderId;
      const folderName = realFolderId ? folderMap[realFolderId] : t('item.no.folder');

      modal.style.display = 'none';
      try {
        const ids = Array.from(selectedItems);
        const idsSet = new Set(ids);

        // Optimistic UI update — instantly update folder in memory
        allDecryptedCiphers.forEach(c => {
          if (idsSet.has(c.id)) {
            if (c.raw) c.raw.FolderId = realFolderId;
          }
        });
        analysisResult = analyzeCiphers(allDecryptedCiphers);
        healthResult = analyzeHealth(allDecryptedCiphers);
        selectedItems.clear();
        updateBatchBar();
        updateSidebarBadges();
        renderFolderList();
        switchView(currentView);

        showToast(`✅ ${ids.length} ${t('dup.items')} ${t('folder.move.ok')} ${folderName}`, 'success');

        // Server-side move (background)
        await client.bulkMoveCiphersToFolder(ids, realFolderId);
        // Background resync
        resyncVault();
      } catch (err) {
        showToast(`❌ ${t('toast.op.fail')}: ${err.message}`, 'error');
        resyncVault();
      }
    });
  });
}

// ========================
// FOLDER VIEW
// ========================
function renderFolderView() {
  const container = $('#view-folder');
  if (!selectedFolderId) {
    container.innerHTML = `<div class="empty-state">${t('folder.select')}</div>`;
    return;
  }

  const folderName = folderMap[selectedFolderId] || t('folder.unknown');
  let items = allDecryptedCiphers.filter(c => c.raw?.FolderId === selectedFolderId);

  // Apply search and filters to folder items
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    items = items.filter(c => {
      const name = (c.decrypted?.name || '').toLowerCase();
      const username = (c.decrypted?.username || '').toLowerCase();
      const uris = (c.decrypted?.uris || []).join(' ').toLowerCase();
      return name.includes(q) || username.includes(q) || uris.includes(q);
    });
  }

  const typeIcons = { 1: '🔐', 2: '📝', 3: '💳', 4: '🪪' };

  container.innerHTML = `
    <div class="section-header">
      <span class="section-title">📁 ${escHtml(folderName)}</span>
      <span class="results-count">${items.length} ${t('item.items')}</span>
    </div>
    <div class="section-header">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.82rem;color:var(--text-secondary)">
        <input type="checkbox" id="folder-select-all-cb" class="item-checkbox" /> ${t('item.selectall')}
      </label>
    </div>
    ${items.map(c => `
      <div class="vault-item ${selectedItems.has(c.id) ? 'selected' : ''}" data-id="${c.id}">
        <input type="checkbox" class="item-checkbox item-select-cb" data-id="${c.id}" ${selectedItems.has(c.id) ? 'checked' : ''}/>
        <div class="item-type-icon">${typeIcons[c.type] || '📄'}</div>
        <div class="item-info">
          <div class="item-name">${escHtml(c.decrypted?.name || t('item.untitled'))}</div>
          <div class="item-meta">
            ${c.decrypted?.username ? `<span>👤 ${escHtml(c.decrypted.username)}</span>` : ''}
            ${(c.decrypted?.uris?.filter(Boolean) || []).length > 0 ? `<span>🔗 ${linkUri(c.decrypted.uris[0])}</span>` : ''}
          </div>
        </div>
        <div class="item-tags">
          ${(c.raw?.Login?.Fido2Credentials?.length || 0) > 0 ? '<span class="mini-tag passkey">🔑</span>' : ''}
          ${c.decrypted?.totp ? '<span class="mini-tag totp">🕐</span>' : ''}
        </div>
      </div>
    `).join('') || `<div class="empty-state">${t('folder.view.empty')}</div>`}
  `;

  // Event delegation for clicks
  container.addEventListener('click', (e) => {
    const item = e.target.closest('.vault-item');
    if (!item) return;

    if (e.target.classList.contains('item-select-cb')) {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        selectedItems.add(id);
        item.classList.add('selected');
      } else {
        selectedItems.delete(id);
        item.classList.remove('selected');
      }
      updateBatchBar();
      return;
    }

    const cipher = allDecryptedCiphers.find(c => c.id === item.dataset.id);
    if (cipher) openDetailDrawer(cipher);
  });

  // Select all for folder view
  $('#folder-select-all-cb')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    items.forEach(c => {
      if (checked) selectedItems.add(c.id);
      else selectedItems.delete(c.id);
    });
    updateBatchBar();
    renderFolderView();
  });
}

// ========================
// DETAIL DRAWER
// ========================
function setupDetailDrawer() {
  $('#detail-close-btn').addEventListener('click', closeDetailDrawer);
  $('#detail-overlay').addEventListener('click', (e) => {
    if (e.target === $('#detail-overlay')) closeDetailDrawer();
  });
}

function openDetailDrawer(cipher) {
  const overlay = $('#detail-overlay');
  overlay.style.display = 'block';

  $('#detail-title').textContent = cipher.decrypted?.name || t('item.untitled');

  const body = $('#detail-body');
  const typeLabels = { 1: t('detail.type.login'), 2: t('detail.type.note'), 3: t('detail.type.card'), 4: t('detail.type.identity') };
  const d = cipher.decrypted;

  let html = '';

  // ── Section: Item Info ──
  html += `<div class="detail-section">
    <div class="detail-section-title">${t('detail.section.info')}</div>
    ${detailField(t('detail.type'), typeLabels[cipher.type] || t('detail.type.unknown'), false)}
    ${detailField(t('detail.folder'), folderMap[cipher.raw?.FolderId] || t('item.no.folder'), false)}
    ${d.favorite ? `<div class="detail-field"><div class="detail-label">${t('detail.favorite')}</div><div class="detail-value">${t('detail.favorited')}</div></div>` : ''}
    ${d.organizationId ? detailField(t('detail.org'), d.organizationId, false) : ''}
  </div>`;

  // ── Section: Login Credentials ──
  if (cipher.type === 1) {
    html += `<div class="detail-section"><div class="detail-section-title">${t('detail.section.login')}</div>`;
    if (d.username) html += detailField(t('detail.username'), d.username, true);

    const pw = d.password || '';
    if (pw) {
      html += `<div class="detail-field">
        <div class="detail-label">${t('detail.password')}</div>
        <div class="detail-value">
          <span class="detail-pw" id="pw-display">${'•'.repeat(Math.min(pw.length, 20))}</span>
          <button class="pw-toggle" onclick="togglePw(this, '${escAttr(pw)}')">👁</button>
          <button class="copy-btn" onclick="copyText('${escAttr(pw)}', this)">📋</button>
        </div>
      </div>`;
    }

    if (d.totp) {
      html += `<div class="detail-field">
        <div class="detail-label">${t('detail.totp.key')}</div>
        <div class="detail-value">
          <span class="detail-pw">${'•'.repeat(12)}</span>
          <button class="pw-toggle" onclick="togglePw(this, '${escAttr(d.totp)}')">👁</button>
          <button class="copy-btn" onclick="copyText('${escAttr(d.totp)}', this)">📋</button>
        </div>
      </div>`;
    }

    if (d.passwordRevisionDate) {
      html += detailField(t('detail.pw.date'), new Date(d.passwordRevisionDate).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US'), false);
    }

    // Passkeys
    const passkeys = cipher.raw?.Login?.Fido2Credentials || [];
    if (passkeys.length > 0) {
      html += `<div class="detail-field"><div class="detail-label">${t('detail.passkey')}</div>
        <div class="detail-value"><span class="has-passkey">🔑 ${passkeys.length}${t('detail.passkey.count')}</span></div></div>`;
    }
    html += '</div>';
  }

  // ── Section: URIs ──
  const uris = d.uris?.filter(Boolean) || [];
  if (uris.length > 0) {
    html += `<div class="detail-section"><div class="detail-section-title">${t('detail.section.autofill')}</div>`;
    uris.forEach((u, idx) => {
      html += `<div class="detail-field"><div class="detail-label">${t('detail.uri')} ${uris.length > 1 ? idx + 1 : ''}</div>
        <div class="detail-value">${escHtml(u)}
          <button class="copy-btn" onclick="copyText('${escAttr(u)}', this)">📋</button>
        </div></div>`;
    });
    html += '</div>';
  }

  // ── Section: Card ──
  if (cipher.type === 3 && d.card) {
    html += `<div class="detail-section"><div class="detail-section-title">${t('detail.section.card')}</div>`;
    if (d.card.brand) html += detailField(t('detail.card.brand'), d.card.brand, false);
    if (d.card.cardholderName) html += detailField(t('detail.card.holder'), d.card.cardholderName, true);
    if (d.card.number) {
      html += `<div class="detail-field"><div class="detail-label">${t('detail.card.number')}</div>
        <div class="detail-value">
          <span class="detail-pw">${'•'.repeat(12)}</span>
          <button class="pw-toggle" onclick="togglePw(this, '${escAttr(d.card.number)}')">👁</button>
          <button class="copy-btn" onclick="copyText('${escAttr(d.card.number)}', this)">📋</button>
        </div></div>`;
    }
    if (d.card.expMonth || d.card.expYear) {
      html += detailField(t('detail.card.expiry'), `${d.card.expMonth || '??'}/${d.card.expYear || '????'}`, false);
    }
    if (d.card.code) {
      html += `<div class="detail-field"><div class="detail-label">${t('detail.card.cvv')}</div>
        <div class="detail-value">
          <span class="detail-pw">•••</span>
          <button class="pw-toggle" onclick="togglePw(this, '${escAttr(d.card.code)}')">👁</button>
          <button class="copy-btn" onclick="copyText('${escAttr(d.card.code)}', this)">📋</button>
        </div></div>`;
    }
    html += '</div>';
  }

  // ── Section: Identity ──
  if (cipher.type === 4 && d.identity) {
    const id = d.identity;
    html += `<div class="detail-section"><div class="detail-section-title">${t('detail.section.identity')}</div>`;
    const idFields = [
      [t('detail.id.title'), id.title], [t('detail.id.first'), id.firstName], [t('detail.id.middle'), id.middleName],
      [t('detail.id.last'), id.lastName], [t('detail.id.company'), id.company], [t('detail.id.email'), id.email],
      [t('detail.id.phone'), id.phone], [t('detail.id.user'), id.username],
      [t('detail.id.passport'), id.passportNumber], [t('detail.id.license'), id.licenseNumber],
      ['SSN', id.ssn],
      [t('detail.id.addr1'), id.address1], [t('detail.id.addr2'), id.address2], [t('detail.id.addr3'), id.address3],
      [t('detail.id.city'), id.city], [t('detail.id.state'), id.state],
      [t('detail.id.zip'), id.postalCode], [t('detail.id.country'), id.country],
    ];
    idFields.forEach(([label, val]) => {
      if (val) html += detailField(label, val, true);
    });
    html += '</div>';
  }

  // ── Section: Custom Fields ──
  if (d.fields && d.fields.length > 0) {
    html += `<div class="detail-section"><div class="detail-section-title">${t('detail.section.fields')}</div>`;
    d.fields.forEach(f => {
      if (f.type === 1) { // hidden
        html += `<div class="detail-field"><div class="detail-label">${escHtml(f.name || t('detail.field.noname'))}</div>
          <div class="detail-value">
            <span class="detail-pw">${'•'.repeat(8)}</span>
            <button class="pw-toggle" onclick="togglePw(this, '${escAttr(f.value || '')}')">👁</button>
            <button class="copy-btn" onclick="copyText('${escAttr(f.value || '')}', this)">📋</button>
          </div></div>`;
      } else if (f.type === 2) { // boolean
        html += detailField(f.name || t('detail.field.noname'), f.value === 'true' ? t('detail.field.yes') : t('detail.field.no'), false);
      } else { // text or linked
        html += detailField(f.name || t('detail.field.noname'), f.value || '', true);
      }
    });
    html += '</div>';
  }

  // ── Section: Notes ──
  if (d.notes) {
    html += `<div class="detail-section"><div class="detail-section-title">${t('detail.section.extra')}</div>
      <div class="detail-field"><div class="detail-label">${t('detail.notes')}</div>
        <div class="detail-value" style="white-space:pre-wrap">${escHtml(d.notes)}</div></div>`;
    if (d.reprompt === 1) {
      html += `<div class="detail-field"><div class="detail-label">${t('detail.reprompt')}</div><div class="detail-value">${t('detail.reprompt.enabled')}</div></div>`;
    }
    html += '</div>';
  } else if (d.reprompt === 1) {
    html += `<div class="detail-section"><div class="detail-section-title">${t('detail.section.extra')}</div>
      <div class="detail-field"><div class="detail-label">${t('detail.reprompt')}</div><div class="detail-value">${t('detail.reprompt.enabled')}</div></div></div>`;
  }

  // ── Section: Metadata ──
  html += `<div class="detail-section detail-meta-section">
    ${detailField(t('detail.date.modified'), new Date(cipher.raw?.RevisionDate).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US'), false)}
    ${d.creationDate ? detailField(t('detail.date.created'), new Date(d.creationDate).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US'), false) : ''}
    ${detailField('ID', cipher.id, true)}
  </div>`;

  // ── Edit + Delete Buttons ──
  html += `<div class="detail-actions">
    <button class="detail-edit-btn" id="detail-edit-btn">${t('detail.btn.edit')}</button>
    <button class="detail-delete-btn" id="detail-delete-btn">${t('detail.btn.delete')}</button>
  </div>`;

  // ── Diagnostic Buttons (only for corrupted items) ──
  const isCorrupted = d.error || !d.name;
  if (isCorrupted) {
    html += `<div class="detail-actions detail-diag-actions" style="margin-top:4px;gap:8px">
      <button class="detail-diag-btn" id="detail-log-btn">📋 解密日志</button>
      <button class="detail-diag-btn detail-refetch-btn" id="detail-refetch-btn">🔄 重新获取</button>
    </div>`;
  }

  body.innerHTML = html;

  // Wire up edit button
  $('#detail-edit-btn')?.addEventListener('click', () => {
    closeDetailDrawer();
    openEditDrawer(cipher);
  });

  // Wire up delete button
  $('#detail-delete-btn')?.addEventListener('click', () => deleteCurrentCipher(cipher));

  // Wire up diagnostic buttons
  if (isCorrupted) {
    $('#detail-log-btn')?.addEventListener('click', () => showDecryptLog(cipher));
    $('#detail-refetch-btn')?.addEventListener('click', () => refetchSingleCipher(cipher));
  }
}

/**
 * Show decrypt log modal for a cipher
 */
function showDecryptLog(cipher) {
  const log = cipher.decrypted?.decryptLog || [];
  const errors = cipher.decrypted?.decryptErrors || [];

  let html = `<div class="decrypt-log-overlay" id="decrypt-log-overlay">
    <div class="decrypt-log-modal">
      <div class="decrypt-log-header">
        <span>📋 解密日志 · ${escHtml(cipher.decrypted?.name || '(无标题)')}</span>
        <button class="decrypt-log-close" id="decrypt-log-close">✕</button>
      </div>
      <div class="decrypt-log-summary">
        <span>ID: <code>${cipher.id}</code></span>
        <span>状态: ${errors.length > 0 ? `<span style="color:#f87171">❌ ${errors.length} 个字段失败</span>` : '<span style="color:#4ade80">✅ 全部成功</span>'}</span>
        ${errors.length > 0 ? `<span>失败字段: <code>${errors.join(', ')}</code></span>` : ''}
      </div>
      <div class="decrypt-log-body">
        <table class="decrypt-log-table">
          <thead><tr><th>字段</th><th>状态</th><th>详情</th></tr></thead>
          <tbody>
            ${log.map(entry => {
              const icon = entry.status === 'ok' ? '✅' : entry.status === 'fail' ? '❌' : entry.status === 'skip' ? '⏭️' : 'ℹ️';
              const cls = entry.status === 'fail' ? 'log-fail' : entry.status === 'ok' ? 'log-ok' : 'log-skip';
              return `<tr class="${cls}"><td>${escHtml(entry.field)}</td><td>${icon}</td><td>${escHtml(entry.detail)}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        ${log.length === 0 ? '<div style="padding:16px;text-align:center;color:var(--text-secondary)">无日志数据 (演示模式不产生解密日志)</div>' : ''}
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const overlay = $('#decrypt-log-overlay');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  $('#decrypt-log-close')?.addEventListener('click', () => overlay.remove());
}

/**
 * Re-fetch a single cipher from the API and re-decrypt it
 */
async function refetchSingleCipher(cipher) {
  if (isDemoMode) {
    showToast('演示模式下不支持重新获取', 'warning');
    return;
  }

  const btn = $('#detail-refetch-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 获取中...'; }

  try {
    // Fetch fresh cipher data from API
    const freshRaw = await client.getCipher(cipher.id);

    // Re-decrypt with logging
    const logEntries = [];
    const decryptErrors = [];
    logEntries.push({ field: '⏱ 重新获取时间', status: 'info', detail: new Date().toLocaleString('zh-CN') });
    logEntries.push({ field: '📡 API 请求', status: 'ok', detail: `成功获取 cipher ${cipher.id.substring(0, 8)}...` });

    // Check if raw data actually has encrypted fields
    if (!freshRaw.Name) {
      logEntries.push({ field: '⚠️ 原始数据检查', status: 'fail', detail: '云端数据中 Name 字段为空 — 数据可能本身已损坏' });
    } else {
      logEntries.push({ field: '⚠️ 原始数据检查', status: 'ok', detail: `Name 字段存在 (${freshRaw.Name.substring(0, 40)}...)` });
    }

    const rawName = await decryptFieldWithRetry(freshRaw.Name, symmetricKey, 5, logEntries, '名称 (Name)');
    const rawNotes = await decryptFieldWithRetry(freshRaw.Notes, symmetricKey, 5, logEntries, '备注 (Notes)');
    if (fieldFailed(rawName)) decryptErrors.push('name');
    if (fieldFailed(rawNotes)) decryptErrors.push('notes');

    // Update cipher in place
    cipher.raw = freshRaw;
    cipher.decrypted.name = fieldValue(rawName);
    cipher.decrypted.notes = fieldValue(rawNotes);

    // Login type
    if (freshRaw.Type === 1 && freshRaw.Login) {
      const rawUsername = await decryptFieldWithRetry(freshRaw.Login.Username, symmetricKey, 5, logEntries, '用户名 (Username)');
      const rawPassword = await decryptFieldWithRetry(freshRaw.Login.Password, symmetricKey, 5, logEntries, '密码 (Password)');
      const rawTotp = await decryptFieldWithRetry(freshRaw.Login.Totp, symmetricKey, 5, logEntries, 'TOTP');
      if (fieldFailed(rawUsername)) decryptErrors.push('username');
      if (fieldFailed(rawPassword)) decryptErrors.push('password');
      if (fieldFailed(rawTotp)) decryptErrors.push('totp');
      cipher.decrypted.username = fieldValue(rawUsername);
      cipher.decrypted.password = fieldValue(rawPassword);
      cipher.decrypted.totp = fieldValue(rawTotp);

      if (freshRaw.Login.Uris) {
        cipher.decrypted.uris = [];
        for (let i = 0; i < freshRaw.Login.Uris.length; i++) {
          const rawUri = await decryptFieldWithRetry(freshRaw.Login.Uris[i].Uri, symmetricKey, 5, logEntries, `URI ${i + 1}`);
          if (fieldFailed(rawUri)) decryptErrors.push('uri');
          cipher.decrypted.uris.push(fieldValue(rawUri));
        }
      }
    }

    // Custom fields
    if (freshRaw.Fields && freshRaw.Fields.length > 0) {
      cipher.decrypted.fields = [];
      for (let i = 0; i < freshRaw.Fields.length; i++) {
        const f = freshRaw.Fields[i];
        const rawFName = await decryptFieldWithRetry(f.Name || f.name, symmetricKey, 5, logEntries, `自定义字段[${i + 1}].标签`);
        const rawFValue = await decryptFieldWithRetry(f.Value || f.value, symmetricKey, 5, logEntries, `自定义字段[${i + 1}].值`);
        if (fieldFailed(rawFName)) decryptErrors.push('field.name');
        if (fieldFailed(rawFValue)) decryptErrors.push('field.value');
        const fieldType = f.Type ?? f.type ?? 0;
        cipher.decrypted.fields.push({ name: fieldValue(rawFName), value: fieldValue(rawFValue), type: fieldType });
      }
    }

    // Update log and error state
    cipher.decrypted.decryptLog = logEntries;
    if (decryptErrors.length > 0) {
      cipher.decrypted.decryptErrors = decryptErrors;
      cipher.decrypted.error = `Fields failed: ${decryptErrors.join(', ')}`;
    } else {
      delete cipher.decrypted.decryptErrors;
      delete cipher.decrypted.error;
    }

    // Re-analyze and refresh UI
    analysisResult = analyzeCiphers(allDecryptedCiphers);
    healthResult = analyzeHealth(allDecryptedCiphers);
    updateSidebarBadges();

    // Re-open the detail drawer with updated data
    openDetailDrawer(cipher);

    if (decryptErrors.length > 0) {
      showToast(`重新获取完成，仍有 ${decryptErrors.length} 个字段解密失败`, 'warning');
    } else {
      showToast('🎉 重新获取并解密成功！条目已恢复', 'success');
      // Refresh corrupted view
      if (currentView === 'corrupted') renderCorruptedView();
    }
  } catch (err) {
    console.error('[Refetch] Failed:', err);
    showToast(`获取失败: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 重新获取'; }
  }
}

function closeDetailDrawer() {
  $('#detail-overlay').style.display = 'none';
}

function detailField(label, value, copyable) {
  return `<div class="detail-field"><div class="detail-label">${label}</div>
    <div class="detail-value">${escHtml(value)}${copyable ? `<button class="copy-btn" onclick="copyText('${escAttr(value)}', this)">📋</button>` : ''}</div></div>`;
}

// Global functions for inline handlers
window.togglePw = (btn, pw) => {
  const span = btn.previousElementSibling;
  if (span.dataset.visible === 'true') {
    span.textContent = '•'.repeat(Math.min(pw.length, 20));
    span.dataset.visible = 'false';
    btn.textContent = '👁';
  } else {
    span.textContent = pw;
    span.dataset.visible = 'true';
    btn.textContent = '🙈';
  }
};

window.copyText = async (text, btn) => {
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('copied');
    btn.textContent = '✅';
    setTimeout(() => { btn.classList.remove('copied'); btn.textContent = '📋'; }, 1500);
  } catch { /* ignore */ }
};

// ========================
// EDIT DRAWER
// ========================
function openEditDrawer(cipher) {
  const overlay = $('#detail-overlay');
  overlay.style.display = 'block';

  $('#detail-title').textContent = t('edit.title.prefix') + (cipher.decrypted?.name || t('item.untitled'));

  const body = $('#detail-body');
  const d = cipher.decrypted;
  const uris = d.uris?.filter(Boolean) || [];
  const fields = d.fields || [];

  // Build folder options
  const folderOptions = Object.entries(folderMap)
    .map(([id, name]) => `<option value="${id}" ${cipher.raw?.FolderId === id ? 'selected' : ''}>${escHtml(name)}</option>`)
    .join('');

  let html = '<div class="edit-form">';

  // ── Item Info ──
  html += `<div class="edit-section">
    <div class="edit-section-title">${t('edit.section.info')}</div>
    <div class="edit-field">
      <label>${t('edit.label.name')}</label>
      <input type="text" id="edit-name" value="${escAttr(d.name || '')}">
    </div>
    <div class="edit-field">
      <label>${t('edit.label.folder')}</label>
      <select id="edit-folder">
        <option value="">${t('edit.folder.none')}</option>
        ${folderOptions}
      </select>
    </div>
  </div>`;

  // ── Login Credentials ──
  if (cipher.type === 1) {
    html += `<div class="edit-section">
      <div class="edit-section-title">${t('edit.section.login')}</div>
      <div class="edit-field">
        <label>${t('edit.label.user')}</label>
        <input type="text" id="edit-username" value="${escAttr(d.username || '')}">
      </div>
      <div class="edit-field">
        <label>${t('edit.label.pw')}</label>
        <input type="password" id="edit-password" value="${escAttr(d.password || '')}">
      </div>
      <div class="edit-field">
        <label>${t('detail.totp.key')}</label>
        <input type="text" id="edit-totp" value="${escAttr(d.totp || '')}" placeholder="otpauth:// or key">
      </div>
    </div>`;

    // ── URIs ──
    html += `<div class="edit-section">
      <div class="edit-section-title">${t('edit.section.uris')}</div>
      <div id="edit-uris-container">
        ${uris.map((u, i) => `<div class="uri-row" data-idx="${i}">
          <input type="text" class="edit-uri" value="${escAttr(u)}">
          <button class="uri-remove-btn" type="button" onclick="this.parentElement.remove()">✕</button>
        </div>`).join('')}
      </div>
      <button class="add-btn" type="button" id="add-uri-btn">${t('edit.add.uri')}</button>
    </div>`;
  }

  // ── Notes + Reprompt ──
  html += `<div class="edit-section">
    <div class="edit-section-title">${t('detail.section.extra')}</div>
    <div class="edit-field">
      <label>${t('edit.section.notes')}</label>
      <textarea id="edit-notes">${escHtml(d.notes || '')}</textarea>
    </div>
    <div class="edit-field" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="edit-reprompt" ${d.reprompt === 1 ? 'checked' : ''}>
      <label for="edit-reprompt" style="margin:0;text-transform:none;font-size:0.88rem">${t('detail.reprompt')}</label>
    </div>
  </div>`;

  // ── Custom Fields (4 types: 0=text, 1=hidden, 2=boolean, 3=linked) ──
  const fieldTypeLabel = { 0: t('detail.type.unknown') === 'Unknown' ? 'Text' : '文本型', 1: getLocale() === 'en' ? 'Hidden' : '隐藏型', 2: getLocale() === 'en' ? 'Boolean' : '复选框型', 3: getLocale() === 'en' ? 'Linked' : '链接型' };
  function buildFieldRow(f = { name: '', value: '', type: 0 }, idx = 0) {
    const typeOptions = [0,1,2,3].map(t =>
      `<option value="${t}" ${f.type === t ? 'selected' : ''}>${fieldTypeLabel[t]}</option>`
    ).join('');
    let valueHtml = '';
    if (f.type === 2) {
      // Boolean → checkbox
      valueHtml = `<label class="cf-checkbox-wrap"><input type="checkbox" class="edit-field-value" ${f.value === 'true' ? 'checked' : ''} data-field-type="2"><span>${getLocale() === 'en' ? 'Enabled' : '已启用'}</span></label>`;
    } else {
      const inputType = f.type === 1 ? 'password' : 'text';
      const placeholder = f.type === 3 ? (getLocale() === 'en' ? 'html ID, name, aria-label, or placeholder' : 'html ID、名称、aria-label 或占位符') : (getLocale() === 'en' ? 'Value' : '值');
      valueHtml = `<input type="${inputType}" class="edit-field-value" value="${escAttr(f.value || '')}" placeholder="${placeholder}" data-field-type="${f.type}">`;
    }
    return `<div class="custom-field-row" data-idx="${idx}">
      <div class="cf-name-type">
        <input type="text" class="edit-field-name" value="${escAttr(f.name || '')}" placeholder="${getLocale() === 'en' ? 'Field label' : '字段标签'}">
        <select class="edit-field-type">${typeOptions}</select>
      </div>
      <div class="cf-value-action">
        ${valueHtml}
        <button class="field-remove-btn" type="button" onclick="this.parentElement.parentElement.remove()">✕</button>
      </div>
    </div>`;
  }
  html += `<div class="edit-section">
    <div class="edit-section-title">${t('detail.section.fields')}</div>
    <div id="edit-fields-container">
      ${fields.map((f, i) => buildFieldRow(f, i)).join('')}
    </div>
    <button class="add-btn" type="button" id="add-field-btn">${getLocale() === 'en' ? '+ Add Field' : '＋ 添加字段'}</button>
  </div>`;

  // ── Passkeys (read-only info) ──
  const passkeys = cipher.raw?.Login?.Fido2Credentials || [];
  if (passkeys.length > 0) {
    html += `<div class="edit-section">
      <div class="edit-section-title">${t('detail.passkey')}</div>
      <div class="detail-field"><div class="detail-value"><span class="has-passkey">🔑 ${passkeys.length}${t('detail.passkey.count')} ${getLocale() === 'en' ? '(read-only)' : '（不可编辑）'}</span></div></div>
    </div>`;
  }

  // ── Actions ──
  html += `<div class="edit-actions">
    <button class="edit-save-btn" id="edit-save-btn">${t('edit.btn.save')}</button>
    <button class="edit-cancel-btn" id="edit-cancel-btn">${t('edit.btn.cancel')}</button>
  </div>
  <div class="edit-danger-zone">
    <button class="edit-delete-btn" id="edit-delete-btn">${t('detail.delete')}</button>
  </div>`;

  html += '</div>';
  body.innerHTML = html;

  // Wire up add buttons
  $('#add-uri-btn')?.addEventListener('click', () => {
    const container = $('#edit-uris-container');
    const div = document.createElement('div');
    div.className = 'uri-row';
    div.innerHTML = `<input type="text" class="edit-uri" value="" placeholder="https://">
      <button class="uri-remove-btn" type="button" onclick="this.parentElement.remove()">✕</button>`;
    container.appendChild(div);
  });

  $('#add-field-btn')?.addEventListener('click', () => {
    const container = $('#edit-fields-container');
    const idx = container.children.length;
    const tmp = document.createElement('div');
    tmp.innerHTML = buildFieldRow({ name: '', value: '', type: 0 }, idx);
    const row = tmp.firstElementChild;
    container.appendChild(row);
    wireFieldTypeChange(row);
  });

  // Wire type selector on all existing rows
  function wireFieldTypeChange(row) {
    const sel = row.querySelector('.edit-field-type');
    sel?.addEventListener('change', () => {
      const t = parseInt(sel.value);
      const wrap = row.querySelector('.cf-value-action');
      const oldVal = wrap.querySelector('.edit-field-value');
      const removeBtn = wrap.querySelector('.field-remove-btn');
      let newEl;
      if (t === 2) {
        const label = document.createElement('label');
        label.className = 'cf-checkbox-wrap';
        label.innerHTML = `<input type="checkbox" class="edit-field-value" data-field-type="2"><span>${getLocale() === 'en' ? 'Enabled' : '已启用'}</span>`;
        newEl = label;
      } else {
        newEl = document.createElement('input');
        newEl.type = t === 1 ? 'password' : 'text';
        newEl.className = 'edit-field-value';
        newEl.placeholder = t === 3 ? 'html ID、名称、aria-label 或占位符' : '值';
        newEl.dataset.fieldType = String(t);
      }
      oldVal?.remove();
      // Also remove old checkbox wrap if exists
      wrap.querySelector('.cf-checkbox-wrap')?.remove();
      wrap.insertBefore(newEl, removeBtn);
    });
  }
  document.querySelectorAll('.custom-field-row').forEach(wireFieldTypeChange);

  // Save
  $('#edit-save-btn').addEventListener('click', () => saveEditedCipher(cipher));

  // Cancel
  $('#edit-cancel-btn').addEventListener('click', () => {
    closeDetailDrawer();
    openDetailDrawer(cipher);
  });

  // Delete
  $('#edit-delete-btn')?.addEventListener('click', () => deleteCurrentCipher(cipher));
}

async function saveEditedCipher(cipher) {
  const saveBtn = $('#edit-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  // Demo mode: save plaintext directly to in-memory object
  if (isDemoMode) {
    try {
      cipher.decrypted.name = $('#edit-name')?.value?.trim() || '';
      cipher.raw.Name = cipher.decrypted.name;
      cipher.raw.FolderId = $('#edit-folder')?.value || null;
      cipher.decrypted.notes = $('#edit-notes')?.value || '';
      cipher.raw.Notes = cipher.decrypted.notes;
      cipher.raw.Reprompt = $('#edit-reprompt')?.checked ? 1 : 0;

      if (cipher.type === 1) {
        cipher.decrypted.username = $('#edit-username')?.value || '';
        cipher.decrypted.password = $('#edit-password')?.value || '';
        cipher.decrypted.totp = $('#edit-totp')?.value || '';
        const login = cipher.raw.Login || cipher.raw.login || {};
        login.Username = cipher.decrypted.username;
        login.Password = cipher.decrypted.password;
        login.Totp = cipher.decrypted.totp || null;
        const uriInputs = [...document.querySelectorAll('.edit-uri')];
        login.Uris = uriInputs.filter(i => i.value.trim()).map(i => ({ Uri: i.value.trim(), Match: null }));
        cipher.decrypted.uri = login.Uris[0]?.Uri || '';
      }

      // Custom fields
      const fieldRows = [...document.querySelectorAll('.custom-field-row')];
      cipher.decrypted.fields = fieldRows.map(row => {
        const fn = row.querySelector('.edit-field-name')?.value?.trim() || '';
        const ft = parseInt(row.querySelector('.edit-field-type')?.value ?? row.querySelector('.edit-field-value')?.dataset?.fieldType ?? '0');
        const fv = ft === 2 ? (row.querySelector('.edit-field-value')?.checked ? 'true' : 'false') : (row.querySelector('.edit-field-value')?.value || '');
        return { name: fn, value: fv, type: ft };
      });
      cipher.raw.Fields = cipher.decrypted.fields.map(f => ({ Name: f.name, Value: f.value, Type: f.type }));

      showToast('✅ 条目已保存', 'success');
      closeDetailDrawer();
      await resyncVault();
    } catch (err) {
      showToast(`❌ 保存失败: ${err.message}`, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 保存';
    }
    return;
  }

  try {
    // Gather form values
    const name = $('#edit-name')?.value?.trim() || '';
    const folderId = $('#edit-folder')?.value || null;
    const notes = $('#edit-notes')?.value || '';
    const reprompt = $('#edit-reprompt')?.checked ? 1 : 0;

    // Start from the original API response
    const updated = JSON.parse(JSON.stringify(cipher.raw._original));

    // Re-encrypt changed fields
    updated.Name = updated.name = await encryptString(name, symmetricKey);
    updated.Notes = updated.notes = notes ? await encryptString(notes, symmetricKey) : null;
    updated.FolderId = updated.folderId = folderId;
    updated.Reprompt = updated.reprompt = reprompt;

    if (cipher.type === 1) {
      const login = updated.Login || updated.login || {};
      const username = $('#edit-username')?.value || '';
      const password = $('#edit-password')?.value || '';
      const totp = $('#edit-totp')?.value || '';

      login.Username = login.username = await encryptString(username, symmetricKey);
      login.Password = login.password = await encryptString(password, symmetricKey);
      login.Totp = login.totp = totp ? await encryptString(totp, symmetricKey) : null;

      // URIs
      const uriInputs = [...document.querySelectorAll('.edit-uri')];
      const uris = [];
      for (const input of uriInputs) {
        const val = input.value.trim();
        if (val) {
          uris.push({
            Uri: await encryptString(val, symmetricKey),
            uri: await encryptString(val, symmetricKey),
            Match: null,
            match: null,
          });
        }
      }
      login.Uris = login.uris = uris;

      updated.Login = updated.login = login;
    }

    // Custom fields (4 types: 0=text, 1=hidden, 2=boolean, 3=linked)
    const fieldRows = [...document.querySelectorAll('.custom-field-row')];
    if (fieldRows.length > 0) {
      const encFields = [];
      for (const row of fieldRows) {
        const nameInput = row.querySelector('.edit-field-name');
        const typeSelect = row.querySelector('.edit-field-type');
        const valueInput = row.querySelector('.edit-field-value');
        const fieldType = parseInt(typeSelect?.value ?? valueInput?.dataset?.fieldType ?? '0');
        const fn = nameInput?.value?.trim() || '';
        let fv;
        if (fieldType === 2) {
          // Boolean: checkbox → "true" / "false"
          fv = valueInput?.checked ? 'true' : 'false';
        } else {
          fv = valueInput?.value || '';
        }
        encFields.push({
          Name: await encryptString(fn, symmetricKey),
          name: await encryptString(fn, symmetricKey),
          Value: await encryptString(fv, symmetricKey),
          value: await encryptString(fv, symmetricKey),
          Type: fieldType,
          type: fieldType,
        });
      }
      updated.Fields = updated.fields = encFields;
    } else {
      updated.Fields = updated.fields = null;
    }

    await client.updateCipher(cipher.id, updated);

    showToast('✅ 条目已保存', 'success');
    closeDetailDrawer();

    // Re-sync to get updated data
    await resyncVault();
  } catch (err) {
    console.error('Save error:', err);
    showToast(`❌ 保存失败: ${err.message}`, 'error');
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 保存';
  }
}
/**
 * Delete a cipher from detail/edit drawer
 * Shows confirmation, soft deletes, closes drawer, hot-updates all views
 */
async function deleteCurrentCipher(cipher) {
  showConfirm(
    '删除条目',
    `确认删除「${cipher.decrypted?.name || '(无标题)'}」？\n条目将移入回收站，30天内可恢复。`,
    async () => {
      try {
        await client.softDeleteBulk([cipher.id]);
        showToast('✅ 已删除，已移入回收站', 'success');
        closeDetailDrawer();
        await resyncVault();
      } catch (err) {
        console.error('Delete error:', err);
        showToast(`❌ 删除失败: ${err.message}`, 'error');
      }
    }
  );
}

let modalResolve = null;

function showConfirm(title, message, onConfirm) {
  const modal = $('#confirm-modal');
  $('#modal-title').textContent = title;
  $('#modal-message').textContent = message;
  modal.style.display = 'flex';

  const confirmBtn = $('#modal-confirm');
  const cancelBtn = $('#modal-cancel');

  const cleanup = () => { modal.style.display = 'none'; };

  confirmBtn.onclick = () => { cleanup(); onConfirm(); };
  cancelBtn.onclick = cleanup;
}

function closeModal() {
  $('#confirm-modal').style.display = 'none';
}

// ========================
// TOAST
// ========================
function showToast(message, type = 'info') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ========================
// MERGE PROGRESS & REPORT
// ========================
function showMergeProgress() {
  const overlay = $('#merge-progress-overlay');
  const bar = $('#merge-progress-bar');
  const text = $('#merge-progress-text');
  bar.style.width = '0%';
  text.textContent = '准备中...';
  overlay.style.display = 'flex';
}

function updateMergeProgress(pct, label) {
  const bar = $('#merge-progress-bar');
  const text = $('#merge-progress-text');
  bar.style.width = `${Math.min(pct, 100)}%`;
  text.textContent = `${pct}% — ${label}`;
}

function hideMergeProgress() {
  const overlay = $('#merge-progress-overlay');
  setTimeout(() => { overlay.style.display = 'none'; }, 300);
}

function showMergeReport(successGroups, successDeletes, failures) {
  const modal = $('#merge-report-modal');
  const title = $('#merge-report-title');
  const body = $('#merge-report-body');
  const closeBtn = $('#merge-report-close');

  const hasFails = failures.length > 0;
  title.textContent = hasFails ? '⚠️ 合并完成（部分失败）' : '✅ 合并全部成功';

  let html = '<div class="report-summary">';
  html += `<div><span class="success">✅ 成功合并:</span> ${successGroups} 组`;
  if (successDeletes > 0) html += `，删除 ${successDeletes} 条`;
  html += '</div>';
  if (hasFails) {
    html += `<div><span class="fail">❌ 失败:</span> ${failures.length} 项</div>`;
  }
  html += '</div>';

  if (hasFails) {
    html += '<ul class="report-fail-list">';
    for (const f of failures) {
      html += `<li>
        <span class="fail-icon">❌</span>
        <div class="fail-detail">
          <div class="fail-label">${escapeHtml(f.label)}</div>
          <div class="fail-reason">${escapeHtml(f.reason)}</div>
        </div>
      </li>`;
    }
    html += '</ul>';
  }

  body.innerHTML = html;
  modal.style.display = 'flex';
  closeBtn.onclick = () => { modal.style.display = 'none'; };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========================
// DECRYPT VAULT
// ========================
/**
 * Try to decrypt a single field with up to maxRetries attempts
 */
async function decryptFieldWithRetry(cipherString, keys, maxRetries = 5, logEntries = null, fieldLabel = '') {
  if (!cipherString) {
    if (logEntries && fieldLabel) logEntries.push({ field: fieldLabel, status: 'skip', detail: '字段为空' });
    return null;
  }
  let lastErr = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await decryptToString(cipherString, keys);
      if (logEntries && fieldLabel) logEntries.push({ field: fieldLabel, status: 'ok', detail: `解密成功 (尝试 ${attempt + 1}/${maxRetries})` });
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
      }
    }
  }
  const errMsg = lastErr?.message || 'Unknown error';
  console.warn(`Field decrypt failed after ${maxRetries} retries:`, errMsg);
  if (logEntries && fieldLabel) logEntries.push({ field: fieldLabel, status: 'fail', detail: `${maxRetries}次重试后失败: ${errMsg}` });
  return { __decryptFailed: true, error: errMsg };
}

/** Extract usable value from decryptFieldWithRetry result; null if failed */
function fieldValue(result) {
  if (result && typeof result === 'object' && result.__decryptFailed) return null;
  return result;
}

/** Check if a decrypt result is a failure marker */
function fieldFailed(result) {
  return result && typeof result === 'object' && result.__decryptFailed === true;
}

/** Get error message from a failure marker */
function fieldError(result) {
  return (result && typeof result === 'object' && result.__decryptFailed) ? result.error : null;
}

async function decryptAllCiphers(syncData) {
  const ciphers = syncData.Ciphers || [];
  const decrypted = [];
  let failCount = 0;

  for (const cipher of ciphers) {
    const decryptErrors = [];
    const logEntries = []; // Detailed per-field log
    logEntries.push({ field: '⏱ 时间', status: 'info', detail: new Date().toLocaleString('zh-CN') });

    // Decrypt each field independently — partial success is OK
    const rawName = await decryptFieldWithRetry(cipher.Name, symmetricKey, 5, logEntries, '名称 (Name)');
    const rawNotes = await decryptFieldWithRetry(cipher.Notes, symmetricKey, 5, logEntries, '备注 (Notes)');

    if (fieldFailed(rawName)) decryptErrors.push('name');
    if (fieldFailed(rawNotes)) decryptErrors.push('notes');

    const item = {
      id: cipher.Id,
      type: cipher.Type,
      raw: cipher,
      decrypted: {
        name: fieldValue(rawName),
        notes: fieldValue(rawNotes),
        favorite: cipher.Favorite || false,
        reprompt: cipher.Reprompt || 0,
        organizationId: cipher.OrganizationId,
        creationDate: cipher.CreationDate,
      },
    };

    // Login type
    if (cipher.Type === 1 && cipher.Login) {
      const rawUsername = await decryptFieldWithRetry(cipher.Login.Username, symmetricKey, 5, logEntries, '用户名 (Username)');
      const rawPassword = await decryptFieldWithRetry(cipher.Login.Password, symmetricKey, 5, logEntries, '密码 (Password)');
      const rawTotp = await decryptFieldWithRetry(cipher.Login.Totp, symmetricKey, 5, logEntries, 'TOTP');

      if (fieldFailed(rawUsername)) decryptErrors.push('username');
      if (fieldFailed(rawPassword)) decryptErrors.push('password');
      if (fieldFailed(rawTotp)) decryptErrors.push('totp');

      item.decrypted.username = fieldValue(rawUsername);
      item.decrypted.password = fieldValue(rawPassword);
      item.decrypted.totp = fieldValue(rawTotp);
      item.decrypted.passwordRevisionDate = cipher.Login.PasswordRevisionDate;

      if (cipher.Login.Uris) {
        item.decrypted.uris = [];
        for (let i = 0; i < cipher.Login.Uris.length; i++) {
          const rawUri = await decryptFieldWithRetry(cipher.Login.Uris[i].Uri, symmetricKey, 5, logEntries, `URI ${i + 1}`);
          if (fieldFailed(rawUri)) decryptErrors.push('uri');
          item.decrypted.uris.push(fieldValue(rawUri));
        }
      }
    }

    // Card type
    if (cipher.Type === 3 && cipher.Card) {
      const card = cipher.Card;
      const cardFieldMap = {
        cardholderName: ['持卡人', card.CardholderName || card.cardholderName],
        number: ['卡号', card.Number || card.number],
        expMonth: ['过期月', card.ExpMonth || card.expMonth],
        expYear: ['过期年', card.ExpYear || card.expYear],
        code: ['安全码', card.Code || card.code],
        brand: ['品牌', card.Brand || card.brand],
      };
      item.decrypted.card = {};
      for (const [k, [label, val]] of Object.entries(cardFieldMap)) {
        const rawVal = await decryptFieldWithRetry(val, symmetricKey, 5, logEntries, `卡片.${label}`);
        if (fieldFailed(rawVal)) decryptErrors.push(`card.${k}`);
        item.decrypted.card[k] = fieldValue(rawVal);
      }
    }

    // Identity type
    if (cipher.Type === 4 && cipher.Identity) {
      const id = cipher.Identity;
      item.decrypted.identity = {};
      const identityFields = [
        'Title', 'FirstName', 'MiddleName', 'LastName', 'Company',
        'Email', 'Phone', 'Username', 'PassportNumber', 'LicenseNumber',
        'SSN', 'Address1', 'Address2', 'Address3',
        'City', 'State', 'PostalCode', 'Country',
      ];
      for (const field of identityFields) {
        const key = field.charAt(0).toLowerCase() + field.slice(1);
        const rawVal = await decryptFieldWithRetry(id[field] || id[key], symmetricKey, 5, logEntries, `身份.${field}`);
        if (fieldFailed(rawVal)) decryptErrors.push(`identity.${key}`);
        item.decrypted.identity[key] = fieldValue(rawVal);
      }
    }

    // Custom fields
    if (cipher.Fields && cipher.Fields.length > 0) {
      item.decrypted.fields = [];
      for (let i = 0; i < cipher.Fields.length; i++) {
        const f = cipher.Fields[i];
        const rawFName = await decryptFieldWithRetry(f.Name || f.name, symmetricKey, 5, logEntries, `自定义字段[${i + 1}].标签`);
        const rawFValue = await decryptFieldWithRetry(f.Value || f.value, symmetricKey, 5, logEntries, `自定义字段[${i + 1}].值`);
        if (fieldFailed(rawFName)) decryptErrors.push('field.name');
        if (fieldFailed(rawFValue)) decryptErrors.push('field.value');
        const fieldType = f.Type ?? f.type ?? 0;
        item.decrypted.fields.push({ name: fieldValue(rawFName), value: fieldValue(rawFValue), type: fieldType });
      }
    }

    // Store full log
    item.decrypted.decryptLog = logEntries;

    // Mark items with ANY decrypt failures
    if (decryptErrors.length > 0) {
      item.decrypted.decryptErrors = decryptErrors;
      item.decrypted.error = `Fields failed: ${decryptErrors.join(', ')}`;
      failCount++;
    }

    decrypted.push(item);
  }

  if (failCount > 0) {
    console.warn(`${failCount}/${ciphers.length} items had decrypt failures`);
  }

  return decrypted;
}

// ========================
// RE-SYNC
// ========================
async function resyncVault() {
  if (isDemoMode) {
    // Demo mode: re-analyze from memory, no API
    analysisResult = analyzeCiphers(allDecryptedCiphers);
    healthResult = analyzeHealth(allDecryptedCiphers);
    selectedItems.clear();
    updateBatchBar();
    updateSidebarBadges();
    renderFolderList();
    switchView(currentView);
    return;
  }

  vaultData = await client.sync();
  allDecryptedCiphers = await decryptAllCiphers(vaultData);
  allDecryptedTrash = await decryptAllCiphers({ Ciphers: vaultData.Trash || [] });
  analysisResult = analyzeCiphers(allDecryptedCiphers);
  healthResult = analyzeHealth(allDecryptedCiphers);
  selectedItems.clear();
  updateBatchBar();

  // Rebuild folder map
  folderMap = {};
  if (vaultData.Folders) {
    for (const f of vaultData.Folders) {
      try {
        folderMap[f.Id] = await decryptToString(f.Name, symmetricKey) || '(未命名)';
      } catch {
        folderMap[f.Id] = '(解密失败)';
      }
    }
  }

  updateSidebarBadges();
  renderFolderList();
  switchView(currentView);
}

// ========================
// SYNC BUTTON
// ========================
function setupSyncButton() {
  const btn = $('#sync-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('syncing')) return;
    btn.classList.add('syncing');
    btn.querySelector('span').textContent = '同步中…';
    try {
      await resyncVault();
      showToast('✅ 密码库已同步', 'success');
    } catch (err) {
      showToast(`❌ 同步失败: ${err.message}`, 'error');
    } finally {
      btn.classList.remove('syncing');
      btn.querySelector('span').textContent = '同步';
    }
  });
}

// ========================
// LOGOUT
// ========================
function setupLogout() {
  $('#logout-btn').addEventListener('click', () => {
    clearSession();
    client = null;
    symmetricKey = null;
    vaultData = null;
    allDecryptedCiphers = [];
    allDecryptedTrash = [];
    location.reload();
  });
}

// ========================
// RENDER: OVERVIEW
// ========================
function renderOverview() {
  const stats = analysisResult.stats;
  const health = healthResult;
  const container = $('#view-overview');

  // Health ring
  const circumference = 2 * Math.PI * 52;
  const offset = circumference - (health.score / 100) * circumference;
  const color = health.score >= 80 ? 'var(--success)' : health.score >= 50 ? 'var(--warn)' : 'var(--danger)';

  container.innerHTML = `
    <div class="health-ring-container">
      <div class="health-ring">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle class="health-ring-bg" cx="60" cy="60" r="52"/>
          <circle class="health-ring-fg" cx="60" cy="60" r="52"
            stroke="${color}"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"/>
        </svg>
        <div class="health-score-value">
          <span class="health-score-num" style="color:${color}">${health.score}</span>
          <span class="health-score-label">${t('overview.health.score')}</span>
        </div>
      </div>
      <div class="health-issues-summary">
        ${health.issues.map(i => `
          <div class="health-issue-row clickable" data-health-filter="${i.id}" style="cursor:pointer">
            <span class="issue-dot ${i.severity}"></span>
            <span class="issue-count">${i.count}</span>
            <span>${i.label}</span>
          </div>
        `).join('') || `<div class="health-issue-row" style="color:var(--success)">🎉 ${getLocale() === 'en' ? 'Your vault is very healthy!' : '你的保险库非常健康！'}</div>`}
      </div>
    </div>

    <div class="overview-grid">
      <div class="stat-card clickable" onclick="document.querySelector('[data-view=all]').click()">
        <div class="stat-number">${stats.totalItems}</div>
        <div class="stat-label">${t('overview.title')}</div>
      </div>
      <div class="stat-card clickable" onclick="document.querySelector('[data-view=all]').click()">
        <div class="stat-number">${stats.loginItems}</div>
        <div class="stat-label">${t('overview.logins')}</div>
      </div>
      <div class="stat-card warn clickable" onclick="document.querySelector('[data-view=duplicates]').click()">
        <div class="stat-number">${stats.exactDuplicateGroups + stats.sameSiteDuplicateGroups}</div>
        <div class="stat-label">${t('overview.dup.groups')}</div>
      </div>
      <div class="stat-card warn clickable" onclick="document.querySelector('[data-view=duplicates]').click()">
        <div class="stat-number">${stats.totalDuplicateItems}</div>
        <div class="stat-label">${t('overview.cleanable')}</div>
      </div>
      <div class="stat-card info clickable" onclick="document.querySelector('[data-view=orphans]').click()">
        <div class="stat-number">${stats.orphanItems}</div>
        <div class="stat-label">${t('overview.orphans')}</div>
      </div>
    </div>

    <h3 style="margin-bottom: 12px; font-size: 0.95rem; color: var(--text-secondary)">${t('overview.quick')}</h3>
    <div class="quick-actions">
      <button class="quick-action-btn" onclick="document.querySelector('[data-view=duplicates]').click()">
        <span class="quick-action-icon">🔀</span> ${t('overview.quick.dedup')}
      </button>
      <button class="quick-action-btn" onclick="document.querySelector('[data-view=health]').click()">
        <span class="quick-action-icon">🛡️</span> ${t('overview.quick.weak')}
      </button>
      <button class="quick-action-btn" id="qa-no-url">
        <span class="quick-action-icon">🔗</span> ${t('overview.quick.nourl')}
      </button>
      <button class="quick-action-btn" id="qa-no-name">
        <span class="quick-action-icon">📝</span> ${t('overview.quick.notitle')}
      </button>
      <button class="quick-action-btn" id="qa-no-folder">
        <span class="quick-action-icon">📂</span> ${t('overview.quick.nofolder')}
      </button>
    </div>
  `;

  // Quick action handlers for "all" view with filter
  $('#qa-no-url')?.addEventListener('click', () => {
    activeFilters.clear();
    activeFilters.add('no-url');
    switchView('all');
    $$('.filter-tag').forEach(t => {
      t.classList.toggle('active', t.dataset.filter === 'no-url');
    });
  });

  $('#qa-no-name')?.addEventListener('click', () => {
    activeFilters.clear();
    activeFilters.add('no-name');
    switchView('all');
    $$('.filter-tag').forEach(t => {
      t.classList.toggle('active', t.dataset.filter === 'no-name');
    });
  });

  $('#qa-no-folder')?.addEventListener('click', () => {
    activeFilters.clear();
    activeFilters.add('no-folder');
    switchView('all');
    $$('.filter-tag').forEach(t => {
      t.classList.toggle('active', t.dataset.filter === 'no-folder');
    });
  });

  // Health issue row click → jump to filtered all view
  const healthFilterMap = { 'weak-pw': 'weak-pw', 'empty-pw': 'empty-pw', 'http': 'http-uri', 'no-url': 'no-url', 'no-name': 'no-name', 'decrypt-fail': 'decrypt-fail' };
  container.querySelectorAll('.health-issue-row[data-health-filter]').forEach(row => {
    row.addEventListener('click', () => {
      const healthId = row.dataset.healthFilter;
      const filterId = healthFilterMap[healthId];
      if (filterId) {
        activeFilters.clear();
        activeFilters.add(filterId);
        switchView('all');
        $$('.filter-tag').forEach(t => {
          t.classList.toggle('active', t.dataset.filter === filterId);
        });
      } else {
        // For reused-pw, stale — go to health view
        switchView('health');
      }
    });
  });
}

// ========================
// RENDER: ALL ITEMS
// ========================
function renderAllItems() {
  const container = $('#view-all');
  const filtered = searchAndFilter(allDecryptedCiphers, {
    query: searchQuery,
    activeFilters,
    typeFilter: null,
    sortId,
  });

  const typeIcons = { 1: '🔐', 2: '📝', 3: '💳', 4: '🪪' };

  // === Group items by first letter (A-Z + #) ===
  const letterGroups = {};
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const c of filtered) {
    const name = (c.decrypted?.name || '').trim();
    let firstChar = name.charAt(0).toUpperCase();
    // Only A-Z counts as a letter group; everything else → #
    if (!firstChar || !LETTERS.includes(firstChar)) {
      firstChar = '#';
    }
    if (!letterGroups[firstChar]) letterGroups[firstChar] = [];
    letterGroups[firstChar].push(c);
  }

  // Sort letters: A-Z first, then #
  const sortedLetters = Object.keys(letterGroups).sort((a, b) => {
    if (a === '#') return 1;
    if (b === '#') return -1;
    return a.localeCompare(b);
  });

  // === Build HTML ===
  const hasGroups = sortedLetters.length > 0 && filtered.length > 0;

  container.innerHTML = `
    <div class="results-count">${filtered.length} / ${allDecryptedCiphers.length} 条目</div>
    <div class="section-header">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.82rem;color:var(--text-secondary)">
        <input type="checkbox" id="select-all-cb" class="item-checkbox" /> 全选
      </label>
    </div>
    <div class="all-items-body" style="position:relative">
      ${hasGroups ? `
        <!-- A-Z Quick Index -->
        <div class="az-index-strip" id="az-index-strip">
          ${sortedLetters.map(l => `<button class="az-index-letter" data-letter="${l}">${l}</button>`).join('')}
        </div>
      ` : ''}
      <div class="all-items-list">
        ${sortedLetters.map(letter => `
          <div class="letter-section" id="letter-section-${letter}">
            <div class="letter-section-header">${letter}</div>
            ${letterGroups[letter].map(c => `
              <div class="vault-item ${selectedItems.has(c.id) ? 'selected' : ''}" data-id="${c.id}">
                <input type="checkbox" class="item-checkbox item-select-cb" data-id="${c.id}" ${selectedItems.has(c.id) ? 'checked' : ''}/>
                <div class="item-type-icon">${typeIcons[c.type] || '📄'}</div>
                <div class="item-info">
                  <div class="item-name">${escHtml(c.decrypted?.name || '(无标题)')}</div>
                  <div class="item-meta">
                    ${c.decrypted?.username ? `<span>👤 ${escHtml(c.decrypted.username)}</span>` : ''}
                    ${(c.decrypted?.uris?.filter(Boolean) || []).length > 0 ? `<span>🔗 ${linkUri(c.decrypted.uris[0])}</span>` : ''}
                    <span>📁 ${escHtml(folderMap[c.raw?.FolderId] || '—')}</span>
                  </div>
                </div>
                <div class="item-tags">
                  ${(c.raw?.Login?.Fido2Credentials?.length || 0) > 0 ? '<span class="mini-tag passkey">🔑</span>' : ''}
                  ${c.decrypted?.totp ? '<span class="mini-tag totp">🕐</span>' : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `).join('') || '<div class="empty-state">没有匹配的条目</div>'}
      </div>
    </div>
  `;

  // === A-Z Index click → scroll to section ===
  container.querySelectorAll('.az-index-letter').forEach(btn => {
    btn.addEventListener('click', () => {
      const letter = btn.dataset.letter;
      const section = document.getElementById(`letter-section-${letter}`);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // === Scroll spy: highlight active letter ===
  const mainContent = document.querySelector('.main-content');
  if (mainContent && hasGroups) {
    const onScroll = () => {
      const strip = document.getElementById('az-index-strip');
      if (!strip) return;
      const sections = container.querySelectorAll('.letter-section');
      let activeLetter = sortedLetters[0];
      for (const sec of sections) {
        const rect = sec.getBoundingClientRect();
        if (rect.top <= 120) {
          activeLetter = sec.id.replace('letter-section-', '');
        }
      }
      strip.querySelectorAll('.az-index-letter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.letter === activeLetter);
      });
    };
    mainContent.addEventListener('scroll', onScroll, { passive: true });
    // Also listen on window scroll for non-scrollable-container layouts
    window.addEventListener('scroll', onScroll, { passive: true });
    // Initial highlight
    requestAnimationFrame(onScroll);
  }

  // Event delegation for item clicks
  container.addEventListener('click', (e) => {
    const item = e.target.closest('.vault-item');
    if (!item) return;

    // If clicking checkbox, toggle selection
    if (e.target.classList.contains('item-select-cb')) {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        selectedItems.add(id);
        item.classList.add('selected');
      } else {
        selectedItems.delete(id);
        item.classList.remove('selected');
      }
      updateBatchBar();
      return;
    }

    // Otherwise open detail drawer
    const cipher = allDecryptedCiphers.find(c => c.id === item.dataset.id);
    if (cipher) openDetailDrawer(cipher);
  });

  // Select all
  $('#select-all-cb')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    filtered.forEach(c => {
      if (checked) selectedItems.add(c.id);
      else selectedItems.delete(c.id);
    });
    updateBatchBar();
    renderAllItems();
  });
}

// ========================
// RENDER: DUPLICATES
// ========================
function renderDuplicatesView() {
  const container = $('#view-duplicates');
  const groups = analysisResult.duplicateGroups;

  if (groups.length === 0) {
    container.innerHTML = `<div class="empty-state">${t('dup.empty')}</div>`;
    return;
  }

  // Split into exact and same_site groups
  const exactGroups = groups.filter(g => g.type === 'exact');
  const sameGroups = groups.filter(g => g.type === 'same_site');

  // Filter groups by search query
  let filteredExactGroups = exactGroups;
  let filteredSameGroups = sameGroups;
  if (searchQuery.trim()) {
    filteredExactGroups = exactGroups.filter(g => g.items.some(matchesSearch));
    filteredSameGroups = sameGroups.filter(g => g.items.some(matchesSearch));
  }

  if (filteredExactGroups.length === 0 && filteredSameGroups.length === 0) {
    container.innerHTML = searchQuery.trim()
      ? `<div class="empty-state">🔍 ${t('dup.empty')}</div>`
      : `<div class="empty-state">${t('dup.empty')}</div>`;
    return;
  }

  // Track filtered group indices for select all / deselect all
  const filteredExactIndices = new Set(filteredExactGroups.map(g => groups.indexOf(g)));

  const exactCountLabel = searchQuery.trim()
    ? `${filteredExactGroups.length}/${exactGroups.length}`
    : `${exactGroups.length}`;

  container.innerHTML = `
    ${filteredExactGroups.length > 0 ? `
      <div class="section-header">
        <span class="section-title">${t('dup.exact')} · ${exactCountLabel} ${t('dup.groups')}</span>
        <div class="section-header-actions">
          <button class="section-action-btn" id="dup-select-all">${t('dup.select.all')}</button>
          <button class="section-action-btn" id="dup-deselect-all">${t('dup.deselect.all')}</button>
          <span class="section-hint">${t('dup.exact.hint')}</span>
        </div>
      </div>
      ${filteredExactGroups.map((group, gi) => {
        const globalIdx = groups.indexOf(group);
        return `
        <div class="dup-group" data-group-index="${globalIdx}">
          <div class="dup-group-header">
            <label class="group-checkbox">
              <input type="checkbox" class="group-select" data-gi="${globalIdx}" data-filtered="true" checked>
              <span class="badge badge-exact">${t('dup.exact')}</span>
              ${group.pureDelete
                ? `<span class="badge badge-pure-delete">${t('dup.candelete')}</span>`
                : `<span class="badge badge-needs-merge">${t('dup.needmerge')}</span>`}
              <span class="group-title">${escHtml(group.label)}</span>
              <span class="group-count">${group.items.length} ${t('dup.items')}</span>
            </label>
            <button class="single-merge-btn" data-gi="${globalIdx}">${t('dup.merge.single')}</button>
            ${group.diffFields && group.diffFields.length > 0
              ? `<div class="diff-tags">${group.diffFields.map(d => `<span class="diff-tag">⚠️ ${escHtml(d)}</span>`).join('')}</div>`
              : ''}
          </div>
          <div class="dup-items">
            ${group.items.map((item, ii) => renderExactDupItem(item, globalIdx, ii, ii === 0)).join('')}
          </div>
        </div>`;
      }).join('')}
    ` : ''}

    ${filteredSameGroups.length > 0 ? `
      <div class="section-header" style="margin-top:24px">
        <span class="section-title">${t('dup.samesite')} · ${searchQuery.trim() ? `${filteredSameGroups.length}/${sameGroups.length}` : filteredSameGroups.length} ${t('dup.groups')}</span>
        <span class="section-hint">${t('dup.samesite.hint')}</span>
      </div>
      ${filteredSameGroups.map((group) => {
        const globalIdx = groups.indexOf(group);
        // Group items by username for visual clarity
        const byUser = groupItemsByUsername(group.items);
        return `
        <div class="dup-group site-group" data-group-index="${globalIdx}">
          <div class="dup-group-header">
            <span class="badge badge-site">${t('dup.samesite.badge')}</span>
            ${group.diffFields && group.diffFields.length > 0
              ? group.diffFields.map(d => `<span class="diff-tag">⚠️ ${escHtml(d)}</span>`).join('')
              : ''}
            <span class="group-title">${escHtml(group.label)}</span>
            <span class="group-count">${group.items.length} ${t('dup.items')} · ${byUser.length} ${t('dup.accounts')}</span>
            <button class="single-merge-btn site-merge-btn" data-gi="${globalIdx}">${t('dup.merge.single')}</button>
          </div>
          <div class="dup-items site-items">
            ${byUser.map((userGroup, ui) => `
              ${ui > 0 ? '<div class="username-divider"></div>' : ''}
              ${userGroup.items.length > 1 ? `<div class="username-section-label">👤 ${escHtml(userGroup.username || '—')} · ${userGroup.items.length} ${t('dup.entries')}</div>` : ''}
              ${userGroup.items.map(item => renderSiteDupItem(item, globalIdx)).join('')}
            `).join('')}
          </div>
        </div>`;
      }).join('')}
    ` : ''}

    <div class="merge-bar" id="merge-bar">
      <span id="merge-count"></span>
      <div class="merge-bar-actions">
        <button id="dup-batch-move-btn" class="merge-bar-btn" title="移动到文件夹">📁 ${t('folder.move')}</button>
        <button id="dup-batch-delete-btn" class="merge-bar-btn merge-bar-btn-danger" title="批量删除">🗑️ ${t('detail.btn.delete')}</button>
        <button id="merge-btn" class="merge-btn">${t('dup.merge.btn')}</button>
      </div>
    </div>
  `;

  // Exact groups: radio handlers
  container.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const gi = parseInt(radio.dataset.gi);
      groups[gi].selectedKeepIndex = parseInt(radio.dataset.ii);
    });
  });
  // Set defaults
  groups.filter(g => g.type === 'exact').forEach(g => { g.selectedKeepIndex = 0; });

  // Merge button
  $('#merge-btn').onclick = () => handleMerge(groups);
  updateMergeCount();

  container.querySelectorAll('.group-select').forEach(cb => {
    cb.addEventListener('change', updateMergeCount);
  });

  // Same-site checkbox listeners
  container.querySelectorAll('.site-item-cb').forEach(cb => {
    cb.addEventListener('change', updateMergeCount);
  });

  // Select All / Deselect All buttons
  // Select All — only targets filtered (visible) groups
  $('#dup-select-all')?.addEventListener('click', () => {
    container.querySelectorAll('.group-select[data-filtered="true"]').forEach(cb => { cb.checked = true; });
    updateMergeCount();
  });
  // Deselect All (反选) — only toggles filtered (visible) groups
  $('#dup-deselect-all')?.addEventListener('click', () => {
    container.querySelectorAll('.group-select[data-filtered="true"]').forEach(cb => { cb.checked = !cb.checked; });
    updateMergeCount();
  });

  // Single card merge buttons (both exact and same-site)
  container.querySelectorAll('.single-merge-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gi = parseInt(btn.dataset.gi);
      handleSingleMerge(groups, gi, btn);
    });
  });

  // Batch delete selected items in duplicates view
  $('#dup-batch-delete-btn')?.addEventListener('click', () => {
    const ids = getDupSelectedItemIds();
    if (ids.length === 0) { showToast('请先勾选要删除的条目', 'warning'); return; }
    showConfirm(
      t('batch.delete.title'),
      `${t('modal.confirm')} ${ids.length} ${t('batch.delete.msg')}`,
      async () => {
        try {
          const deleteSet = new Set(ids);
          allDecryptedCiphers = allDecryptedCiphers.filter(c => !deleteSet.has(c.id));
          analysisResult = analyzeCiphers(allDecryptedCiphers);
          healthResult = analyzeHealth(allDecryptedCiphers);
          updateSidebarBadges();
          renderDuplicatesView();
          showToast(`✅ ${ids.length} ${t('dup.items')} ${t('detail.delete.trash')}`, 'success');
          for (let i = 0; i < ids.length; i += 100) {
            await client.softDeleteBulk(ids.slice(i, i + 100));
          }
          resyncVault();
        } catch (err) {
          showToast(`❌ ${t('detail.delete.fail')}: ${err.message}`, 'error');
          resyncVault();
        }
      }
    );
  });

  // Batch move selected items in duplicates view
  $('#dup-batch-move-btn')?.addEventListener('click', () => {
    const ids = getDupSelectedItemIds();
    if (ids.length === 0) { showToast('请先勾选要移动的条目', 'warning'); return; }
    // Temporarily set selectedItems so showMoveFolderModal works
    const savedSelection = new Set(selectedItems);
    selectedItems.clear();
    ids.forEach(id => selectedItems.add(id));
    showMoveFolderModal();
    // After modal closes, restore selection
    const origClose = $('#move-folder-cancel').onclick;
    const restoreAndRefresh = () => {
      selectedItems.clear();
      savedSelection.forEach(id => selectedItems.add(id));
      // Refresh duplicates view after move
      setTimeout(() => {
        analysisResult = analyzeCiphers(allDecryptedCiphers);
        healthResult = analyzeHealth(allDecryptedCiphers);
        updateSidebarBadges();
        renderDuplicatesView();
      }, 500);
    };
    // Patch the move folder option clicks to also refresh duplicates
    $('#move-folder-list').querySelectorAll('.move-folder-option').forEach(btn => {
      const origHandler = btn.onclick;
      btn.addEventListener('click', restoreAndRefresh);
    });
    $('#move-folder-cancel').onclick = () => {
      $('#move-folder-modal').style.display = 'none';
      selectedItems.clear();
      savedSelection.forEach(id => selectedItems.add(id));
    };
  });

  // Click-to-edit: delegate clicks on dup items to open detail drawer
  container.addEventListener('click', (e) => {
    // Skip if clicking on controls (radio, checkbox, label, button)
    if (e.target.matches('input, label, button, select') || e.target.closest('label, button')) return;

    // Find the closest dup-item or site-dup-item
    const itemEl = e.target.closest('.dup-item, .site-dup-item');
    if (!itemEl) return;

    const itemId = itemEl.dataset?.id;
    if (!itemId) return;

    const cipher = allDecryptedCiphers.find(c => c.id === itemId);
    if (cipher) openDetailDrawer(cipher);
  });
}

/**
 * Group items by username for visual layout in same-site groups
 */
function groupItemsByUsername(items) {
  const map = new Map();
  for (const item of items) {
    const user = item.decrypted?.username || '';
    if (!map.has(user)) map.set(user, []);
    map.get(user).push(item);
  }
  // Sort: groups with most items first (most likely to have duplicates)
  return Array.from(map.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([username, items]) => ({ username, items }));
}

/**
 * Render item for exact duplicate group (radio keep/delete)
 */
function renderExactDupItem(item, gi, ii, isFirst) {
  const passkeys = item.raw?.Login?.Fido2Credentials?.length || 0;
  const uris = (item.decrypted?.uris || []).filter(Boolean);

  return `
    <div class="dup-item ${isFirst ? 'keep-item' : 'remove-item'}" data-id="${item.id}">
      <label class="item-radio">
        <input type="radio" name="keep-${gi}" data-gi="${gi}" data-ii="${ii}" ${isFirst ? 'checked' : ''}>
        <span class="radio-label">${isFirst ? `✅ ${t('dup.keep')}` : `🗑️ ${t('dup.remove')}`}</span>
      </label>
      <div class="item-details">
        <div class="item-name">${escHtml(item.decrypted?.name || t('item.untitled'))}</div>
        <div class="item-meta">
          <span>👤 ${escHtml(item.decrypted?.username || '—')}</span>
          <span>🔗 ${uris.length > 0 ? linkUri(uris[0]) : '—'}</span>
          ${passkeys > 0 ? `<span class="has-passkey">🔑 ${passkeys} ${t('detail.passkey')}</span>` : ''}
          ${item.decrypted?.totp ? '<span class="has-totp">🕐 TOTP</span>' : ''}
          <span>📁 ${escHtml(folderMap[item.raw?.FolderId] || t('item.no.folder'))}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render item for same-site group (multi-select checkbox)
 */
function renderSiteDupItem(item, gi) {
  const passkeys = item.raw?.Login?.Fido2Credentials?.length || 0;
  const uris = (item.decrypted?.uris || []).filter(Boolean);
  const fields = item.decrypted?.fields?.length || 0;

  return `
    <div class="dup-item site-dup-item" data-id="${item.id}">
      <label class="item-checkbox-label">
        <input type="checkbox" class="site-item-cb" data-gi="${gi}" data-id="${item.id}">
      </label>
      <div class="item-details">
        <div class="item-name">${escHtml(item.decrypted?.name || t('item.untitled'))}</div>
        <div class="item-meta">
          <span>👤 ${escHtml(item.decrypted?.username || '—')}</span>
          <span>🔗 ${uris.length > 0 ? linkUri(uris[0]) : '—'}</span>
          ${passkeys > 0 ? `<span class="has-passkey">🔑 ${passkeys} ${t('detail.passkey')}</span>` : ''}
          ${item.decrypted?.totp ? '<span class="has-totp">🕐 TOTP</span>' : ''}
          ${fields > 0 ? `<span class="has-fields">📝 ${fields} ${t('detail.section.fields')}</span>` : ''}
          <span>📁 ${escHtml(folderMap[item.raw?.FolderId] || t('item.no.folder'))}</span>
        </div>
      </div>
    </div>
  `;
}

function updateMergeCount() {
  const exactChecked = $$('.group-select:checked').length;
  const exactTotal = $$('.group-select').length;
  const siteChecked = $$('.site-item-cb:checked').length;
  const el = $('#merge-count');
  if (!el) return;
  const parts = [];
  if (exactTotal > 0) parts.push(`${t('dup.exact')} ${exactChecked}/${exactTotal} ${t('dup.groups')}`);
  if (siteChecked > 0) parts.push(`${t('dup.samesite.badge')} ${siteChecked} ${t('dup.entries')}`);
  el.textContent = parts.join(' · ') || t('batch.selected');
}

/** Collect all selected item IDs from duplicates view checkboxes */
function getDupSelectedItemIds() {
  const ids = [];
  // From same-site checkboxes
  document.querySelectorAll('.site-item-cb:checked').forEach(cb => {
    if (cb.dataset.id) ids.push(cb.dataset.id);
  });
  return ids;
}

// ========================
// RENDER: ORPHANS
// ========================
function renderOrphansView() {
  const container = $('#view-orphans');
  const orphans = analysisResult.orphans;

  if (orphans.length === 0) {
    container.innerHTML = `<div class="empty-state">${t('orphan.empty')}</div>`;
    return;
  }

  // Filter orphans by search
  let filteredOrphans = orphans;
  if (searchQuery.trim()) {
    filteredOrphans = orphans.filter(matchesSearch);
  }

  if (filteredOrphans.length === 0) {
    container.innerHTML = searchQuery.trim()
      ? `<div class="empty-state">🔍 ${t('orphan.empty')}</div>`
      : `<div class="empty-state">${t('orphan.empty')}</div>`;
    return;
  }

  const allSelected = filteredOrphans.length > 0 && filteredOrphans.every(c => selectedItems.has(c.id));

  container.innerHTML = `
    <div class="section-header">
      <span class="section-title">
        <label class="select-all-label">
          <input type="checkbox" id="orphan-select-all-cb" ${allSelected ? 'checked' : ''} />
          ${t('select.all')}
        </label>
        ${t('orphan.title')} · ${filteredOrphans.length} ${t('dup.items')}
      </span>
    </div>
    ${filteredOrphans.map(item => {
    const uri = item.decrypted?.uris?.filter(Boolean)?.[0] || '';
    const checked = selectedItems.has(item.id) ? 'checked' : '';
    return `
      <div class="orphan-item selectable" data-id="${item.id}">
        <input type="checkbox" class="item-cb" data-id="${item.id}" ${checked} />
        <div class="item-info">
          <div class="item-name">${escHtml(item.decrypted?.name || t('item.untitled'))}</div>
          <div class="item-meta">
            <span>👤 ${escHtml(item.decrypted?.username || '—')}</span>
            ${uri ? `<span>🔗 ${linkUri(uri)}</span>` : `<span class="orphan-tag">${t('health.nourl')}</span>`}
            <span>📁 ${escHtml(folderMap[item.raw?.FolderId] || t('item.no.folder'))}</span>
          </div>
        </div>
      </div>`;
  }).join('')}
  `;

  // Checkbox events
  container.querySelectorAll('.item-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) selectedItems.add(cb.dataset.id);
      else selectedItems.delete(cb.dataset.id);
      updateBatchBar();
    });
  });

  // Select all — operate on filtered set
  $('#orphan-select-all-cb')?.addEventListener('change', (e) => {
    filteredOrphans.forEach(c => {
      if (e.target.checked) selectedItems.add(c.id);
      else selectedItems.delete(c.id);
    });
    updateBatchBar();
    renderOrphansView();
  });

  // Click row to open detail (but not on checkbox)
  container.querySelectorAll('.orphan-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.item-cb')) return;
      const cipher = allDecryptedCiphers.find(c => c.id === el.dataset.id);
      if (cipher) openDetailDrawer(cipher);
    });
  });
}

// ========================
// RENDER: CORRUPTED VIEW
// ========================
function renderCorruptedView() {
  const container = $('#view-corrupted');
  // Corrupted = decrypt error OR no title
  const corrupted = allDecryptedCiphers.filter(c => c.decrypted?.error || !c.decrypted?.name);

  if (corrupted.length === 0) {
    container.innerHTML = '<div class="empty-state">✅ 未发现损坏条目</div>';
    return;
  }

  let filtered = corrupted;
  if (searchQuery.trim()) {
    filtered = corrupted.filter(matchesSearch);
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">🔍 未找到匹配的损坏条目</div>';
    return;
  }

  const allSelected = filtered.length > 0 && filtered.every(c => selectedItems.has(c.id));

  container.innerHTML = `
    <div class="section-header">
      <span class="section-title">
        <label class="select-all-label">
          <input type="checkbox" id="corrupted-select-all-cb" ${allSelected ? 'checked' : ''} />
          ${t('select.all')}
        </label>
        💀 已损坏条目 · ${filtered.length} 项
      </span>
    </div>
    <div class="corrupted-hint" style="padding:4px 16px 12px;font-size:0.82rem;color:var(--text-secondary)">
      包含解密失败和无标题的条目。建议确认后移入回收站。
    </div>
    ${filtered.map(item => {
      const checked = selectedItems.has(item.id) ? 'checked' : '';
      const hasError = item.decrypted?.error;
      const noName = !item.decrypted?.name;
      const reasons = [];
      if (hasError) {
        const errCount = item.decrypted?.decryptErrors?.length || 0;
        reasons.push(`🔐 解密失败${errCount > 0 ? ` (${errCount}个字段)` : ''}`);
      }
      if (noName && !hasError) reasons.push('📛 无标题');
      const reasonHtml = reasons.map(r => `<span class="orphan-tag" style="color:#f87171">${r}</span>`).join('');
      const uri = item.decrypted?.uris?.filter(Boolean)?.[0] || '';
      return `
      <div class="orphan-item selectable" data-id="${item.id}">
        <input type="checkbox" class="item-cb" data-id="${item.id}" ${checked} />
        <div class="item-info">
          <div class="item-name">${escHtml(item.decrypted?.name || '(无标题)')}</div>
          <div class="item-meta">
            ${reasonHtml}
            <span>👤 ${escHtml(item.decrypted?.username || '—')}</span>
            ${uri ? `<span>🔗 ${linkUri(uri)}</span>` : ''}
            <span>📁 ${escHtml(folderMap[item.raw?.FolderId] || t('item.no.folder'))}</span>
          </div>
        </div>
      </div>`;
    }).join('')}
  `;

  // Checkbox events
  container.querySelectorAll('.item-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) selectedItems.add(cb.dataset.id);
      else selectedItems.delete(cb.dataset.id);
      updateBatchBar();
    });
  });

  // Select all
  $('#corrupted-select-all-cb')?.addEventListener('change', (e) => {
    filtered.forEach(c => {
      if (e.target.checked) selectedItems.add(c.id);
      else selectedItems.delete(c.id);
    });
    updateBatchBar();
    renderCorruptedView();
  });

  // Click row to open detail
  container.querySelectorAll('.orphan-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.item-cb')) return;
      const cipher = allDecryptedCiphers.find(c => c.id === el.dataset.id);
      if (cipher) openDetailDrawer(cipher);
    });
  });
}

// ========================
// URL LIVENESS CHECK
// ========================
/**
 * Check all vault item URLs for liveness.
 * Uses fetch with no-cors to detect truly dead domains (DNS failure / connection timeout).
 * Runs in the background after vault load.
 */
async function checkDeadUrls() {
  deadUrlItems = [];
  deadUrlCheckDone = false;
  updateSidebarBadges();

  // Collect items with web URLs
  const itemsWithUrls = allDecryptedCiphers.filter(c => {
    const uri = c.decrypted?.uris?.filter(Boolean)?.[0];
    return uri && /^https?:\/\//i.test(uri);
  });

  if (itemsWithUrls.length === 0) {
    deadUrlCheckDone = true;
    updateSidebarBadges();
    return;
  }

  // Deduplicate by domain to minimize requests
  const domainMap = new Map(); // domain -> [items]
  for (const item of itemsWithUrls) {
    const uri = item.decrypted.uris[0];
    try {
      const u = new URL(uri);
      const domain = u.hostname.toLowerCase();
      if (!domainMap.has(domain)) domainMap.set(domain, []);
      domainMap.get(domain).push(item);
    } catch {
      // invalid URL — treat as dead
      deadUrlItems.push(item);
    }
  }

  /**
   * Multi-strategy domain liveness check:
   * 1. fetch (no-cors GET) — works for most sites
   * 2. <img> favicon probe — works for sites behind Cloudflare bot-protection
   *    that block fetch but still serve static assets
   * Returns true if domain is alive.
   */
  async function isDomainAlive(domain) {
    const TIMEOUT = 6000;

    // Strategy 1: fetch with no-cors (works for most sites)
    const fetchProbe = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT);
      try {
        await fetch(`https://${domain}/favicon.ico`, {
          method: 'GET',
          mode: 'no-cors',
          signal: controller.signal,
        });
        return true;
      } catch {
        throw new Error('fetch failed');
      } finally {
        clearTimeout(timer);
      }
    })();

    // Strategy 2: <img> favicon probe (works for Cloudflare-protected sites)
    const imgProbe = new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => { img.src = ''; reject(new Error('img timeout')); }, TIMEOUT);
      img.onload = () => { clearTimeout(timer); resolve(true); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('img error')); };
      img.src = `https://${domain}/favicon.ico?_t=${Date.now()}`;
    });

    // Race: any strategy succeeding = domain is alive
    try {
      await Promise.any([fetchProbe, imgProbe]);
      return true;
    } catch {
      return false; // all strategies failed = truly dead
    }
  }

  // Check each unique domain with concurrency limit
  const CONCURRENCY = 10;
  const domains = Array.from(domainMap.keys());
  const deadDomains = new Set();

  for (let i = 0; i < domains.length; i += CONCURRENCY) {
    const batch = domains.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (domain) => {
        const alive = await isDomainAlive(domain);
        if (!alive) deadDomains.add(domain);
      })
    );
  }

  // Collect all items whose domain is dead
  for (const [domain, items] of domainMap) {
    if (deadDomains.has(domain)) {
      deadUrlItems.push(...items);
    }
  }

  deadUrlCheckDone = true;
  updateSidebarBadges();

  // Auto-refresh if user is on this view
  if (currentView === 'dead-urls') {
    renderDeadUrlsView();
  }
}

// ========================
// RENDER: DEAD URLS VIEW
// ========================
function renderDeadUrlsView() {
  const container = $('#view-dead-urls');

  if (!deadUrlCheckDone) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size:2rem;margin-bottom:12px">🔍</div>
        <div>正在检测 URL 连通性…</div>
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:8px">
          系统正在后台逐一检测所有条目的链接，请稍候。
        </div>
      </div>`;
    return;
  }

  if (deadUrlItems.length === 0) {
    container.innerHTML = '<div class="empty-state">✅ 所有 URL 均可正常访问</div>';
    return;
  }

  let filtered = deadUrlItems;
  if (searchQuery.trim()) {
    filtered = deadUrlItems.filter(matchesSearch);
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">🔍 未找到匹配的失效条目</div>';
    return;
  }

  const allSelected = filtered.length > 0 && filtered.every(c => selectedItems.has(c.id));

  container.innerHTML = `
    <div class="section-header">
      <span class="section-title">
        <label class="select-all-label">
          <input type="checkbox" id="deadurl-select-all-cb" ${allSelected ? 'checked' : ''} />
          ${t('select.all')}
        </label>
        🔗 URL 已失效 · ${filtered.length} 项
      </span>
    </div>
    <div style="padding:4px 16px 12px;font-size:0.82rem;color:var(--text-secondary)">
      以下条目的 URL 无法访问（DNS 解析失败或连接超时）。建议确认后移入回收站或更新链接。
    </div>
    ${filtered.map(item => {
      const checked = selectedItems.has(item.id) ? 'checked' : '';
      const uri = item.decrypted?.uris?.filter(Boolean)?.[0] || '';
      return `
      <div class="orphan-item selectable" data-id="${item.id}">
        <input type="checkbox" class="item-cb" data-id="${item.id}" ${checked} />
        <div class="item-info">
          <div class="item-name">${escHtml(item.decrypted?.name || '(无标题)')}</div>
          <div class="item-meta">
            <span class="orphan-tag" style="color:var(--danger)">⚠️ 无法访问</span>
            <span>👤 ${escHtml(item.decrypted?.username || '—')}</span>
            ${uri ? `<span>🔗 ${linkUri(uri)}</span>` : ''}
            <span>📁 ${escHtml(folderMap[item.raw?.FolderId] || t('item.no.folder'))}</span>
          </div>
        </div>
      </div>`;
    }).join('')}
  `;

  // Checkbox events
  container.querySelectorAll('.item-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) selectedItems.add(cb.dataset.id);
      else selectedItems.delete(cb.dataset.id);
      updateBatchBar();
    });
  });

  // Select all
  $('#deadurl-select-all-cb')?.addEventListener('change', (e) => {
    filtered.forEach(c => {
      if (e.target.checked) selectedItems.add(c.id);
      else selectedItems.delete(c.id);
    });
    updateBatchBar();
    renderDeadUrlsView();
  });

  // Click row to open detail
  container.querySelectorAll('.orphan-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.item-cb')) return;
      if (e.target.closest('.uri-link')) return; // Don't open detail when clicking URI link
      const cipher = allDecryptedCiphers.find(c => c.id === el.dataset.id);
      if (cipher) openDetailDrawer(cipher);
    });
  });
}

// ========================
// RENDER: TYPE-FILTERED VIEW (Card, Identity, Note, SSH Key)
// ========================
function renderTypeFilteredView(viewName, typeId, title) {
  const container = $(`#view-${viewName}`);
  const items = allDecryptedCiphers.filter(c => (c.raw?.Type ?? c.raw?.type) === typeId);

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">📭 暂无${title.replace(/^[^\s]+\s/, '')}条目</div>`;
    return;
  }

  let filtered = items;
  if (searchQuery.trim()) {
    filtered = items.filter(matchesSearch);
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">🔍 未找到匹配的${title.replace(/^[^\s]+\s/, '')}条目</div>`;
    return;
  }

  const allSelected = filtered.length > 0 && filtered.every(c => selectedItems.has(c.id));

  // Type-specific subtitle helper
  const getSubtitle = (item) => {
    const dec = item.decrypted;
    switch (typeId) {
      case 3: { // Card
        const brand = dec?.cardBrand || dec?.brand || '';
        const last4 = dec?.cardNumber?.slice(-4) || '';
        return brand ? `${brand} ****${last4}` : (last4 ? `****${last4}` : '—');
      }
      case 4: { // Identity
        const parts = [dec?.firstName, dec?.lastName].filter(Boolean);
        return parts.join(' ') || dec?.username || '—';
      }
      case 2: // Secure Note
        return dec?.notes ? dec.notes.substring(0, 60) + (dec.notes.length > 60 ? '...' : '') : '—';
      case 5: // SSH Key
        return dec?.username || '—';
      default:
        return '—';
    }
  };

  container.innerHTML = `
    <div class="section-header">
      <span class="section-title">
        <label class="select-all-label">
          <input type="checkbox" id="${viewName}-select-all-cb" ${allSelected ? 'checked' : ''} />
          ${t('select.all')}
        </label>
        ${title} · ${filtered.length} 项
      </span>
    </div>
    ${filtered.map(item => {
      const checked = selectedItems.has(item.id) ? 'checked' : '';
      const name = escHtml(item.decrypted?.name || '(无标题)');
      const subtitle = escHtml(getSubtitle(item));
      const folder = escHtml(folderMap[item.raw?.FolderId] || t('item.no.folder'));
      return `
      <div class="orphan-item selectable" data-id="${item.id}">
        <input type="checkbox" class="item-cb" data-id="${item.id}" ${checked} />
        <div class="item-info">
          <div class="item-name">${name}</div>
          <div class="item-meta">
            <span>${subtitle}</span>
            <span>📁 ${folder}</span>
          </div>
        </div>
      </div>`;
    }).join('')}
  `;

  // Checkbox events
  container.querySelectorAll('.item-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) selectedItems.add(cb.dataset.id);
      else selectedItems.delete(cb.dataset.id);
      updateBatchBar();
    });
  });

  // Select all
  $(`#${viewName}-select-all-cb`)?.addEventListener('change', (e) => {
    filtered.forEach(c => {
      if (e.target.checked) selectedItems.add(c.id);
      else selectedItems.delete(c.id);
    });
    updateBatchBar();
    renderTypeFilteredView(viewName, typeId, title);
  });

  // Click row to open detail
  container.querySelectorAll('.orphan-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.item-cb')) return;
      const cipher = allDecryptedCiphers.find(c => c.id === el.dataset.id);
      if (cipher) openDetailDrawer(cipher);
    });
  });
}

// ========================
// RENDER: NO FOLDER VIEW
// ========================
function renderNoFolderView() {
  const container = $('#view-nofolder');
  const items = allDecryptedCiphers.filter(c => !c.raw?.FolderId);

  // Filter by search
  let filteredItems = items;
  if (searchQuery.trim()) {
    filteredItems = items.filter(matchesSearch);
  }

  if (filteredItems.length === 0) {
    container.innerHTML = searchQuery.trim()
      ? '<div class="empty-state">🔍 没有匹配的条目</div>'
      : '<div class="empty-state">✅ 所有条目都已归类到文件夹。</div>';
    return;
  }

  const allSelected = filteredItems.length > 0 && filteredItems.every(c => selectedItems.has(c.id));

  container.innerHTML = `
    <div class="section-header">
      <span class="section-title">
        <label class="select-all-label">
          <input type="checkbox" id="nofolder-select-all-cb" ${allSelected ? 'checked' : ''} />
          全选
        </label>
        无文件夹条目 · ${filteredItems.length} 条
      </span>
    </div>
    ${filteredItems.map(item => {
    const uri = item.decrypted?.uris?.filter(Boolean)?.[0] || '';
    const checked = selectedItems.has(item.id) ? 'checked' : '';
    return `
      <div class="orphan-item selectable" data-id="${item.id}">
        <input type="checkbox" class="item-cb" data-id="${item.id}" ${checked} />
        <div class="item-info">
          <div class="item-name">${escHtml(item.decrypted?.name || '(无标题)')}</div>
          <div class="item-meta">
            <span>👤 ${escHtml(item.decrypted?.username || '—')}</span>
            ${uri ? `<span>🔗 ${linkUri(uri)}</span>` : '<span class="orphan-tag">无URL</span>'}
          </div>
        </div>
      </div>`;
  }).join('')}
  `;

  // Checkbox events
  container.querySelectorAll('.item-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) selectedItems.add(cb.dataset.id);
      else selectedItems.delete(cb.dataset.id);
      updateBatchBar();
    });
  });

  // Select all — operate on filtered set
  $('#nofolder-select-all-cb')?.addEventListener('change', (e) => {
    filteredItems.forEach(c => {
      if (e.target.checked) selectedItems.add(c.id);
      else selectedItems.delete(c.id);
    });
    updateBatchBar();
    renderNoFolderView();
  });

  // Click row to open detail (but not on checkbox)
  container.querySelectorAll('.orphan-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.item-cb')) return;
      const cipher = allDecryptedCiphers.find(c => c.id === el.dataset.id);
      if (cipher) openDetailDrawer(cipher);
    });
  });
}

// ========================
// RENDER: HEALTH
// ========================
function renderHealthView() {
  const container = $('#view-health');
  const health = healthResult;

  if (health.issues.length === 0) {
    container.innerHTML = `<div class="empty-state">${t('health.empty')}</div>`;
    return;
  }

  // Filter health issues' sub-items by search query
  let filteredIssues = health.issues;
  if (searchQuery.trim()) {
    filteredIssues = health.issues.map(issue => {
      const filtered = (issue.items || []).filter(matchesSearch);
      return filtered.length > 0 ? { ...issue, items: filtered, count: filtered.length } : null;
    }).filter(Boolean);
  }

  if (filteredIssues.length === 0) {
    container.innerHTML = `<div class="empty-state">🔍 ${t('health.empty')}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="section-header">
      <span class="section-title">🛡️ ${t('health.title')} · ${t('health.score.label')} ${health.score}/100</span>
    </div>
    ${filteredIssues.map((issue, i) => `
      <div class="health-issue-card" data-index="${i}">
        <div class="health-card-header">
          <div class="severity-indicator ${issue.severity}"></div>
          <div class="health-card-info">
            <div class="health-card-label">${issue.label}</div>
            <div class="health-card-count">${issue.count} ${t('dup.items')}</div>
          </div>
          <span class="health-card-arrow">›</span>
        </div>
        <div class="health-card-items">
          ${(issue.items || []).slice(0, 50).map(c => `
            <div class="health-sub-item" data-id="${c.id}" style="cursor:pointer">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.decrypted?.name || t('item.untitled'))}</span>
              <span style="color:var(--text-muted);flex-shrink:0">${escHtml(c.decrypted?.username || '')}</span>
            </div>
          `).join('')}
          ${(issue.items || []).length > 50 ? `<div class="health-sub-item" style="color:var(--text-muted)">${t('health.more')} (${issue.items.length - 50})</div>` : ''}
        </div>
      </div>
    `).join('')}
  `;

  // Toggle expand
  container.querySelectorAll('.health-issue-card').forEach(card => {
    card.querySelector('.health-card-header').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });

    // Click sub-item to open detail
    card.querySelectorAll('.health-sub-item[data-id]').forEach(sub => {
      sub.addEventListener('click', (e) => {
        e.stopPropagation();
        const cipher = allDecryptedCiphers.find(c => c.id === sub.dataset.id);
        if (cipher) openDetailDrawer(cipher);
      });
    });
  });
}

// ========================
// RENDER: TRASH VIEW
// ========================
function renderTrashView() {
  const container = $('#view-trash');
  const trashItems = allDecryptedTrash;

  if (trashItems.length === 0) {
    container.innerHTML = `<div class="empty-state">${t('trash.empty')}</div>`;
    return;
  }

  // Filter trash by search
  let filteredTrash = trashItems;
  if (searchQuery.trim()) {
    filteredTrash = trashItems.filter(matchesSearch);
  }

  if (filteredTrash.length === 0) {
    container.innerHTML = searchQuery.trim()
      ? `<div class="empty-state">🔍 ${t('trash.empty')}</div>`
      : `<div class="empty-state">${t('trash.empty')}</div>`;
    return;
  }

  const allSelected = filteredTrash.length > 0 && filteredTrash.every(c => selectedItems.has(c.id));

  container.innerHTML = `
    <div class="section-header">
      <span class="section-title">
        <label class="select-all-label">
          <input type="checkbox" id="trash-select-all-cb" ${allSelected ? 'checked' : ''} />
          ${t('select.all')}
        </label>
        🗑️ ${t('trash.title')} · ${filteredTrash.length} ${t('dup.items')}
      </span>
      <span class="section-hint">${t('trash.hint')}</span>
    </div>
    <div class="trash-batch-bar" id="trash-batch-bar" style="display:none">
      <span id="trash-batch-count"></span>
      <div class="batch-actions">
        <button class="batch-btn move" id="trash-restore-btn">${t('trash.restore')}</button>
        <button class="batch-btn danger" id="trash-perm-delete-btn">${t('trash.permdelete')}</button>
        <button class="batch-btn" id="trash-cancel-btn">${t('trash.cancel')}</button>
      </div>
    </div>
    ${filteredTrash.map(item => {
      const uri = item.decrypted?.uris?.filter(Boolean)?.[0] || '';
      const checked = selectedItems.has(item.id) ? 'checked' : '';
      const deletedAt = item.raw?.DeletedDate ? new Date(item.raw.DeletedDate).toLocaleDateString(getLocale() === 'zh' ? 'zh-CN' : 'en-US') : '';
      return `
        <div class="orphan-item selectable" data-id="${item.id}">
          <input type="checkbox" class="item-cb" data-id="${item.id}" ${checked} />
          <div class="item-info">
            <div class="item-name">${escHtml(item.decrypted?.name || t('item.untitled'))}</div>
            <div class="item-meta">
              <span>👤 ${escHtml(item.decrypted?.username || '—')}</span>
              ${uri ? `<span>🔗 ${linkUri(uri)}</span>` : `<span class="orphan-tag">${t('health.nourl')}</span>`}
              ${deletedAt ? `<span class="trash-date">🗓️ ${t('trash.deletedon')} ${deletedAt}</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('')}
  `;

  // Checkbox events
  container.querySelectorAll('.item-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) selectedItems.add(cb.dataset.id);
      else selectedItems.delete(cb.dataset.id);
      updateTrashBatchBar();
    });
  });

  // Select all — operate on filtered set
  $('#trash-select-all-cb')?.addEventListener('change', (e) => {
    filteredTrash.forEach(c => {
      if (e.target.checked) selectedItems.add(c.id);
      else selectedItems.delete(c.id);
    });
    updateTrashBatchBar();
    renderTrashView();
  });

  // Click row to open detail
  container.querySelectorAll('.orphan-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.item-cb')) return;
      const cipher = allDecryptedTrash.find(c => c.id === el.dataset.id);
      if (cipher) openDetailDrawer(cipher);
    });
  });

  // Trash-specific batch buttons
  setupTrashBatchButtons();
}

function updateTrashBatchBar() {
  const bar = $('#trash-batch-bar');
  if (!bar) return;
  if (selectedItems.size > 0) {
    bar.style.display = 'flex';
    $('#trash-batch-count').textContent = `☑ 已选 ${selectedItems.size} 项`;
  } else {
    bar.style.display = 'none';
  }
}

function setupTrashBatchButtons() {
  // Cancel
  $('#trash-cancel-btn')?.addEventListener('click', () => {
    selectedItems.clear();
    updateTrashBatchBar();
    renderTrashView();
  });

  // Restore to folder
  $('#trash-restore-btn')?.addEventListener('click', () => {
    if (selectedItems.size === 0) return;
    showTrashRestoreModal();
  });

  // Permanent delete — 悲观模式：不可逆操作先 API 成功再更新 UI
  $('#trash-perm-delete-btn')?.addEventListener('click', () => {
    if (selectedItems.size === 0) return;
    showConfirm(
      '⛔ 永久删除',
      `确定要永久删除 ${selectedItems.size} 个条目吗？\n\n⚠️ 此操作不可逆，数据将无法恢复！`,
      async () => {
        try {
          const ids = Array.from(selectedItems);

          // Server-side first (pessimistic: confirm deletion before UI update)
          for (let i = 0; i < ids.length; i += 100) {
            await client.permanentDeleteBulk(ids.slice(i, i + 100));
          }

          // Only update UI after API success
          showToast(`✅ 已永久删除 ${ids.length} 个条目`, 'success');
          selectedItems.clear();
          updateTrashBatchBar();
          await resyncVault();
        } catch (err) {
          showToast(`❌ 永久删除失败: ${err.message}`, 'error');
          resyncVault();
        }
      }
    );
  });
}

function showTrashRestoreModal() {
  const modal = $('#move-folder-modal');
  const list = $('#move-folder-list');

  list.innerHTML = `
    <button class="move-folder-option" data-folder-id="__none__">
      <span>📂</span> <span>无文件夹（仅恢复）</span>
    </button>
    ${folderList.map(f => `
      <button class="move-folder-option" data-folder-id="${f.id}">
        <span>📁</span> <span>${escHtml(f.name)}</span>
      </button>
    `).join('')}
  `;

  modal.style.display = 'flex';

  list.querySelectorAll('.move-folder-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetFolderId = btn.dataset.folderId;
      const realFolderId = targetFolderId === '__none__' ? null : targetFolderId;
      const folderName = realFolderId ? folderMap[realFolderId] : '无文件夹';

      modal.style.display = 'none';
      try {
        const ids = Array.from(selectedItems);
        const idsSet = new Set(ids);

        // Optimistic UI — move from trash to main list
        const restoredItems = allDecryptedTrash.filter(c => idsSet.has(c.id));
        allDecryptedTrash = allDecryptedTrash.filter(c => !idsSet.has(c.id));
        restoredItems.forEach(c => {
          if (c.raw) {
            c.raw.DeletedDate = null;
            c.raw.FolderId = realFolderId;
          }
        });
        allDecryptedCiphers = [...allDecryptedCiphers, ...restoredItems];
        analysisResult = analyzeCiphers(allDecryptedCiphers);
        healthResult = analyzeHealth(allDecryptedCiphers);
        selectedItems.clear();
        updateTrashBatchBar();
        updateSidebarBadges();
        renderFolderList();
        renderTrashView();

        showToast(`✅ 已恢复 ${ids.length} 个条目到「${folderName}」`, 'success');

        // Server-side: restore first, then move to folder
        await client.restoreBulk(ids);
        if (realFolderId) {
          await client.bulkMoveCiphersToFolder(ids, realFolderId);
        }
        resyncVault();
      } catch (err) {
        showToast(`❌ 恢复失败: ${err.message}`, 'error');
        resyncVault();
      }
    });
  });
}

// ========================
// MERGE
// ========================
async function handleMerge(groups) {
  // Lock guard: prevent concurrent merges
  if (isMergeLocked) return;

  // === Collect exact groups (radio-selected) ===
  const exactSelectedGroups = [];
  $$('.group-select:checked').forEach(cb => {
    const gi = parseInt(cb.dataset.gi);
    const group = groups[gi];
    const keepIndex = group.selectedKeepIndex || 0;
    exactSelectedGroups.push({ ...group, keepItem: group.items[keepIndex] });
  });

  // === Collect same-site multi-select items ===
  // Group checked items by their parent group, then by username
  const siteCheckedMap = new Map(); // gi -> [item IDs]
  $$('.site-item-cb:checked').forEach(cb => {
    const gi = parseInt(cb.dataset.gi);
    const id = cb.dataset.id;
    if (!siteCheckedMap.has(gi)) siteCheckedMap.set(gi, []);
    siteCheckedMap.get(gi).push(id);
  });

  // Build site merge groups: for each gi, group checked items by username
  const siteMergeGroups = [];
  for (const [gi, checkedIds] of siteCheckedMap) {
    const group = groups[gi];
    const checkedItems = group.items.filter(i => checkedIds.includes(i.id));
    if (checkedItems.length < 2) continue; // Need at least 2 items to merge

    // Group by username: only merge items with same username
    const byUser = new Map();
    for (const item of checkedItems) {
      const user = item.decrypted?.username || '';
      if (!byUser.has(user)) byUser.set(user, []);
      byUser.get(user).push(item);
    }

    // For each username sub-group with 2+ items: create a merge group
    for (const [username, items] of byUser) {
      if (items.length < 2) continue; // Single item for this username, skip

      // sortByQuality puts best item first
      const sorted = [...items].sort((a, b) => {
        const aP = a.raw?.Login?.Fido2Credentials?.length || 0;
        const bP = b.raw?.Login?.Fido2Credentials?.length || 0;
        if (aP !== bP) return bP - aP;
        const aT = a.decrypted?.totp ? 1 : 0;
        const bT = b.decrypted?.totp ? 1 : 0;
        if (aT !== bT) return bT - aT;
        const aF = a.decrypted?.fields?.length || 0;
        const bF = b.decrypted?.fields?.length || 0;
        if (aF !== bF) return bF - aF;
        const aN = a.decrypted?.notes?.length || 0;
        const bN = b.decrypted?.notes?.length || 0;
        if (aN !== bN) return bN - aN;
        return new Date(b.raw?.RevisionDate || 0) - new Date(a.raw?.RevisionDate || 0);
      });

      // Safety guard: skip sub-groups where passwords differ
      const passwords = new Set(sorted.map(i => i.decrypted?.password || ''));
      if (passwords.size > 1) {
        showToast(`⚠️ ${username || '—'} @ ${group.matchKey}：条目密码不同，请检查`, 'warning');
        continue;
      }

      // Safety guard: skip sub-groups where passkeys differ (decrypt before comparing)
      const itemsWithPk = sorted.filter(i => {
        const fido = i.raw?.Login?.Fido2Credentials || i.raw?._original?.Login?.Fido2Credentials || [];
        return fido.length > 0;
      });
      if (itemsWithPk.length > 0) {
        const decryptedPkIds = [];
        for (const item of itemsWithPk) {
          const fido = item.raw?.Login?.Fido2Credentials || item.raw?._original?.Login?.Fido2Credentials || [];
          const ids = [];
          for (const f of fido) {
            const encId = f.CredentialId || f.credentialId || '';
            try {
              const plainId = encId ? await decryptToString(encId, symmetricKey) : '';
              ids.push(plainId);
            } catch { ids.push(encId); } // fallback to encrypted string
          }
          decryptedPkIds.push(ids.sort().join('|'));
        }
        if (new Set(decryptedPkIds).size > 1) {
          showToast(`🔑 ${username || '—'} @ ${group.matchKey}：通行密钥不同，请检查`, 'warning');
          continue;
        }
      }

      siteMergeGroups.push({
        type: 'same_site',
        label: `同站合并: ${username || '—'} @ ${group.matchKey}`,
        items: sorted,
        keepItem: sorted[0],
        pureDelete: false,
        needsMerge: true,
      });
    }
  }

  // Notify if same-site items were selected but couldn't be grouped for merge
  if (siteCheckedMap.size > 0 && siteMergeGroups.length === 0) {
    showToast('⛔ 同站条目的用户名各不相同，无法合并', 'warning');
  }

  const allGroups = [...exactSelectedGroups, ...siteMergeGroups];
  if (allGroups.length === 0) {
    showToast(t('dup.merge.select.hint'), 'warning');
    return;
  }

  // Build confirm message
  const pureDeleteCount = allGroups.filter(g => g.pureDelete).length;
  const mergeCount = allGroups.filter(g => g.needsMerge).length;
  const deleteCount = allGroups.reduce((sum, g) => sum + g.items.length - 1, 0);

  let confirmMsg = `确认处理 ${allGroups.length} 组？\n`;
  if (exactSelectedGroups.length > 0) confirmMsg += `• 完全重复 ${exactSelectedGroups.length} 组\n`;
  if (siteMergeGroups.length > 0) confirmMsg += `• 同站智能合并 ${siteMergeGroups.length} 组（按用户名自动分组）\n`;
  if (pureDeleteCount > 0) confirmMsg += `• 其中 ${pureDeleteCount} 组 100% 相同 → 直接删除\n`;
  if (mergeCount > 0) confirmMsg += `• 其中 ${mergeCount} 组有差异 → 合并后删除\n`;
  confirmMsg += `共删除 ${deleteCount} 个重复条目（移入回收站，30天内可恢复）`;

  showConfirm(
    '智能合并',
    confirmMsg,
    async () => {
      const mergeBtn = $('#merge-btn');
      isMergeLocked = true;
      mergeBtn.disabled = true;
      mergeBtn.textContent = '合并中...';
      updateMergeLockUI(true);

      // Show progress overlay
      showMergeProgress();

      const failures = []; // [{label, reason}]
      let successGroups = 0;
      let successDeletes = 0;

      try {
        const operations = buildMergeOperations(allGroups);
        const totalSteps = (operations.toCreate?.length || 0) + operations.toUpdate.length + (operations.toDelete.length > 0 ? 1 : 0);
        let completedSteps = 0;

        // Engine-level errors
        if (operations.errors && operations.errors.length > 0) {
          for (const e of operations.errors) {
            failures.push({ label: e.groupLabel, reason: e.reason });
          }
        }

        // === Path B: Create new merged items (encrypt → POST → verify) ===
        const createdIds = []; // Track successfully created item IDs
        const failedCreateGroupLabels = new Set();
        for (let idx = 0; idx < (operations.toCreate?.length || 0); idx++) {
          const op = operations.toCreate[idx];
          completedSteps++;
          const pct = Math.round((completedSteps / totalSteps) * 100);
          updateMergeProgress(pct, `新建合并条目 ${idx + 1}/${operations.toCreate.length}...`);

          try {
            const payload = await buildCipherCreatePayload(op, isDemoMode, symmetricKey);
            console.log('[Merge] Path B createCipher:', op.groupLabel);
            const result = await client.createCipher(payload);
            const newId = result.id || result.Id;
            if (!newId) throw new Error('创建成功但未返回ID');
            createdIds.push(newId);
            successGroups++;
          } catch (err) {
            console.error(`[Merge] createCipher failed for ${op.groupLabel}:`, err);
            failedCreateGroupLabels.add(op.groupLabel);
            failures.push({
              label: op.groupLabel,
              reason: `新建合并条目失败: ${err.message}`,
            });
          }
        }

        // === Path C: Update passkey items (existing updateCipher logic) ===
        const failedKeepIds = new Set();
        for (let idx = 0; idx < operations.toUpdate.length; idx++) {
          const op = operations.toUpdate[idx];
          completedSteps++;
          const pct = Math.round((completedSteps / totalSteps) * 100);
          updateMergeProgress(pct, `更新通行密钥条目 ${idx + 1}/${operations.toUpdate.length}...`);

          try {
            if (op.titleOverride) {
              if (isDemoMode) {
                op.data.Name = op.titleOverride;
                if (op.data.name !== undefined) op.data.name = op.titleOverride;
              } else {
                const encTitle = await encryptString(op.titleOverride, symmetricKey);
                op.data.Name = encTitle;
                if (op.data.name !== undefined) op.data.name = encTitle;
              }
            }
            if (op.notesAppend) {
              if (isDemoMode) {
                const currentNotes = op.data.Notes || op.data.notes || '';
                const merged = currentNotes + op.notesAppend;
                op.data.Notes = merged;
                if (op.data.notes !== undefined) op.data.notes = merged;
              } else {
                const currentEncNotes = op.data.Notes || op.data.notes || '';
                let plain = '';
                if (currentEncNotes) {
                  try { plain = await decryptToString(currentEncNotes, symmetricKey) || ''; }
                  catch { plain = ''; }
                }
                const merged = plain + op.notesAppend;
                const encNotes = await encryptString(merged, symmetricKey);
                op.data.Notes = encNotes;
                if (op.data.notes !== undefined) op.data.notes = encNotes;
              }
            }

            const updateResult = await client.updateCipher(op.id, op.data);
            successGroups++;
          } catch (err) {
            console.error(`[Merge] updateCipher ${op.id} failed:`, err);
            failedKeepIds.add(op.id);
            const matchGroup = allGroups.find(g => g.keepItem?.id === op.id);
            failures.push({
              label: matchGroup?.label || op.id,
              reason: `通行密钥条目更新失败: ${err.message}`,
            });
          }
        }

        // === Delete: only items from successful create/update groups ===
        // For Path B failed creates: DO NOT delete original items (they're still needed)
        // For Path C failed updates: still delete duplicates (keepItem stays as-is)
        let safeToDelete = operations.toDelete;
        if (failedCreateGroupLabels.size > 0) {
          // Remove IDs belonging to failed-create groups from deletion list
          const failedGroupItems = new Set();
          for (const group of allGroups) {
            if (failedCreateGroupLabels.has(group.label)) {
              for (const item of group.items) failedGroupItems.add(item.id);
            }
          }
          safeToDelete = safeToDelete.filter(id => !failedGroupItems.has(id));
        }
        if (safeToDelete.length > 0) {
          updateMergeProgress(95, `清理 ${safeToDelete.length} 个重复条目...`);
          try {
            for (let i = 0; i < safeToDelete.length; i += 100) {
              await client.softDeleteBulk(safeToDelete.slice(i, i + 100));
            }
            successDeletes = safeToDelete.length;
          } catch (err) {
            console.error('[Merge] softDeleteBulk failed:', err);
            failures.push({ label: '批量删除', reason: `删除失败: ${err.message}` });
          }
        }

        // Count pure-delete groups as successes
        const pureDeleteGroups = allGroups.filter(g => g.pureDelete);
        successGroups += pureDeleteGroups.length;

        updateMergeProgress(100, '完成！');
        hideMergeProgress();

        // Show report
        showMergeReport(successGroups, successDeletes, failures);

        mergeBtn.textContent = '✅ 完成';
        mergeBtn.className = 'merge-btn success';
        setTimeout(() => resyncVault(), 1500);
      } catch (err) {
        console.error('Merge error:', err);
        hideMergeProgress();
        showToast(`❌ 合并失败: ${err.message}`, 'error');
        mergeBtn.textContent = '🔀 一键合并';
        mergeBtn.className = 'merge-btn';
      } finally {
        mergeBtn.disabled = false;
        isMergeLocked = false;
        updateMergeLockUI(false);
      }
    }
  );
}

/**
 * Update UI for all merge buttons based on lock state
 */
function updateMergeLockUI(locked) {
  document.querySelectorAll('.single-merge-btn').forEach(btn => {
    btn.disabled = locked;
    if (locked) btn.classList.add('locked');
    else btn.classList.remove('locked');
  });
  const mergeBtn = $('#merge-btn');
  if (mergeBtn) mergeBtn.disabled = locked;
}

/**
 * Build a POST /ciphers payload from plaintext merged data.
 * Encrypts all fields using the symmetric key.
 * Follows the official Bitwarden CipherRequest model (camelCase).
 */
async function buildCipherCreatePayload(op, isDemoMode, symKey) {
  const enc = async (val) => {
    if (!val) return null;
    return isDemoMode ? val : await encryptString(val, symKey);
  };

  const payload = {
    type: op.type ?? 1,
    organizationId: null,
    folderId: op.folderId || null,
    name: await enc(op.name || '(无标题)'),
    notes: await enc(op.notes),
    favorite: op.favorite || false,
    reprompt: op.reprompt ?? 0,
  };

  // Login
  if (op.type === 1) {
    const uris = [];
    for (const uri of (op.uris || [])) {
      if (uri) {
        uris.push({
          uri: await enc(uri),
          match: null,
        });
      }
    }
    payload.login = {
      username: await enc(op.username),
      password: await enc(op.password),
      totp: await enc(op.totp),
      uris,
    };
  }

  // Custom fields
  if (op.fields && op.fields.length > 0) {
    payload.fields = [];
    for (const f of op.fields) {
      payload.fields.push({
        name: await enc(f.name),
        value: await enc(f.value),
        type: f.type ?? 0,
      });
    }
  }

  // Password history (raw encrypted, pass-through — already encrypted)
  if (op.passwordHistory && op.passwordHistory.length > 0) {
    payload.passwordHistory = op.passwordHistory.map(h => ({
      password: h.Password || h.password,
      lastUsedDate: h.LastUsedDate || h.lastUsedDate,
    }));
  }

  return payload;
}

/**
 * Handle single card merge — merge one exact group
 */
async function handleSingleMerge(groups, gi, btnEl) {
  if (isMergeLocked) return;

  const group = groups[gi];
  if (!group) return;

  // === Safety guard: block merging same-site items with different usernames ===
  if (group.type === 'same_site') {
    const usernames = new Set(group.items.map(i => i.decrypted?.username || ''));
    if (usernames.size > 1) {
      showToast('⛔ 不同用户名的条目无法合并，以防止凭据丢失', 'warning');
      return;
    }
    // Same username but different passwords → warn and block
    const passwords = new Set(group.items.map(i => i.decrypted?.password || ''));
    if (passwords.size > 1) {
      showToast('⚠️ 条目密码不同，请检查', 'warning');
      return;
    }
  }

  // === Safety guard: block merging items with different passkeys (decrypt to compare) ===
  const itemsWithPasskeys = group.items.filter(i => {
    const fido = i.raw?.Login?.Fido2Credentials || i.raw?._original?.Login?.Fido2Credentials || [];
    return fido.length > 0;
  });
  if (itemsWithPasskeys.length > 0) {
    const decryptedPasskeyIds = [];
    for (const item of itemsWithPasskeys) {
      const fido = item.raw?.Login?.Fido2Credentials || item.raw?._original?.Login?.Fido2Credentials || [];
      const ids = [];
      for (const f of fido) {
        const encId = f.CredentialId || f.credentialId || '';
        try {
          const plainId = encId ? await decryptToString(encId, symmetricKey) : '';
          ids.push(plainId);
        } catch { ids.push(encId); }
      }
      decryptedPasskeyIds.push(ids.sort().join('|'));
    }
    if (new Set(decryptedPasskeyIds).size > 1) {
      showToast('🔑 通行密钥不同，请检查', 'warning');
      return;
    }
  }

  const keepIndex = group.selectedKeepIndex || 0;
  const mergeGroup = { ...group, keepItem: group.items[keepIndex] };

  // Lock immediately
  isMergeLocked = true;
  updateMergeLockUI(true);
  btnEl.disabled = true;
  btnEl.textContent = t('dup.merge.single.ing');
  btnEl.classList.add('merging');

  try {
    const operations = buildMergeOperations([mergeGroup]);

    // === DEBUG ===
    console.group('[SingleMerge] buildMergeOperations result');
    console.log('toCreate count:', operations.toCreate?.length || 0);
    console.log('toUpdate count:', operations.toUpdate.length);
    console.log('toDelete count:', operations.toDelete.length);
    console.log('errors:', operations.errors);
    console.groupEnd();

    if (operations.errors && operations.errors.length > 0) {
      operations.errors.forEach(e => {
        showToast(`⚠️ ${e.groupLabel}: ${e.reason}`, 'warning');
      });
    }

    // === Path B: Create new merged item ===
    let createSuccess = true;
    for (const op of (operations.toCreate || [])) {
      try {
        const payload = await buildCipherCreatePayload(op, isDemoMode, symmetricKey);
        console.log('[SingleMerge] Path B createCipher:', op.groupLabel);
        const result = await client.createCipher(payload);
        const newId = result.id || result.Id;
        if (!newId) throw new Error('创建成功但未返回ID');
        console.log('[SingleMerge] createCipher SUCCESS, new id:', newId);
      } catch (err) {
        console.error('[SingleMerge] createCipher failed:', err);
        createSuccess = false;
        showToast(`❌ 新建合并条目失败: ${err.message}`, 'error');
      }
    }

    // === Path C: Update passkey item ===
    let updateFails = 0;
    for (const op of operations.toUpdate) {
      try {
        if (op.titleOverride) {
          if (isDemoMode) {
            op.data.Name = op.titleOverride;
            if (op.data.name !== undefined) op.data.name = op.titleOverride;
          } else {
            const encTitle = await encryptString(op.titleOverride, symmetricKey);
            op.data.Name = encTitle;
            if (op.data.name !== undefined) op.data.name = encTitle;
          }
        }
        if (op.notesAppend) {
          if (isDemoMode) {
            const currentNotes = op.data.Notes || op.data.notes || '';
            const merged = currentNotes + op.notesAppend;
            op.data.Notes = merged;
            if (op.data.notes !== undefined) op.data.notes = merged;
          } else {
            const currentEncNotes = op.data.Notes || op.data.notes || '';
            let plain = '';
            if (currentEncNotes) {
              try { plain = await decryptToString(currentEncNotes, symmetricKey) || ''; }
              catch { plain = ''; }
            }
            const merged = plain + op.notesAppend;
            const encNotes = await encryptString(merged, symmetricKey);
            op.data.Notes = encNotes;
            if (op.data.notes !== undefined) op.data.notes = encNotes;
          }
        }
        await client.updateCipher(op.id, op.data);
      } catch (err) {
        console.error('[SingleMerge] updateCipher failed:', err);
        updateFails++;
        showToast(`⚠️ 通行密钥条目更新失败 (${err.message})`, 'warning');
      }
    }

    // === Delete: only if Path B succeeded (Path C failures still allow delete) ===
    let safeToDelete = operations.toDelete;
    if (!createSuccess && (operations.toCreate?.length || 0) > 0) {
      // Path B failed — do NOT delete originals
      safeToDelete = [];
      showToast('⛔ 新建失败，原条目未删除', 'error');
    }
    if (safeToDelete.length > 0) {
      for (let i = 0; i < safeToDelete.length; i += 100) {
        await client.softDeleteBulk(safeToDelete.slice(i, i + 100));
      }
    }

    // Optimistic UI update
    const deleteSet = new Set(safeToDelete);
    allDecryptedCiphers = allDecryptedCiphers.filter(c => !deleteSet.has(c.id));
    analysisResult = analyzeCiphers(allDecryptedCiphers);
    healthResult = analyzeHealth(allDecryptedCiphers);
    updateSidebarBadges();
    renderFolderList();
    switchView(currentView);

    if (createSuccess && updateFails === 0) {
      showToast(`✅ ${escHtml(group.label)} 合并完成`, 'success');
    } else {
      showToast(`⚠️ ${escHtml(group.label)} 重复项已删除，但部分数据未合并（条目不可编辑）`, 'warning');
    }

    // Background resync for real mode consistency
    if (!isDemoMode) {
      setTimeout(() => resyncVault(), 1500);
    }
  } catch (err) {
    console.error('[SingleMerge] error:', err);
    showToast(`❌ 合并失败: ${err.message}`, 'error');
    btnEl.textContent = t('dup.merge.single');
    btnEl.classList.remove('merging');
  } finally {
    isMergeLocked = false;
    updateMergeLockUI(false);
  }
}

// ========================
// UTILS
// ========================
function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Wrap a URI string as a clickable link (opens in new tab).
 * Non-web URIs (androidapp://, iosapp://) are displayed as plain text.
 */
function linkUri(uri) {
  if (!uri) return '';
  const escaped = escHtml(uri);
  // Only linkify http/https URLs
  if (/^https?:\/\//i.test(uri)) {
    return `<a href="${escAttr(uri)}" target="_blank" rel="noopener noreferrer" class="uri-link" onclick="event.stopPropagation()">${escaped}</a>`;
  }
  return escaped;
}

function escAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ========================
// CREDENTIAL FILE SYSTEM
// ========================
const CRED_APP_SALT = 'BW-VaultManager-CredFile-v1';

async function deriveCredFileKey() {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(CRED_APP_SALT), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('bw-credfile-salt-2026'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptCredentials(data) {
  const key = await deriveCredFileKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  // Combine: [12-byte IV][ciphertext] then Base64-encode for text-based download
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  // Convert to Base64 string
  let binary = '';
  for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i]);
  return btoa(binary);
}

async function decryptCredentials(buffer) {
  const key = await deriveCredFileKey();
  let data;
  // Support both Base64 text (new) and raw binary (legacy)
  if (buffer instanceof ArrayBuffer) {
    const text = new TextDecoder().decode(buffer);
    try {
      // Try Base64 decode first
      const binary = atob(text.trim());
      data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
    } catch {
      // Fallback: raw binary
      data = new Uint8Array(buffer);
    }
  } else {
    data = new Uint8Array(buffer);
  }
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function setupCredFileImport() {
  const dropZone = $('#cred-drop-zone');
  const fileInput = $('#cred-file-input');
  const browseBtn = $('#cred-browse-btn');

  if (!dropZone || !fileInput) return;

  browseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleCredFile(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach(evt =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-active');
    })
  );

  ['dragleave', 'drop'].forEach(evt =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-active');
    })
  );

  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleCredFile(file);
  });
}

async function handleCredFile(file) {
  setLoginState('loading', '正在解密凭证文件...');

  try {
    const buffer = await file.arrayBuffer();
    const creds = await decryptCredentials(buffer);

    // Fill in the API Key fields
    if (creds.clientId) $('#client-id').value = creds.clientId;
    if (creds.clientSecret) $('#client-secret').value = creds.clientSecret;
    if (creds.email) $('#api-email').value = creds.email;
    if (creds.password) $('#api-password').value = creds.password;
    if (creds.serverUrl) $('#server-url').value = creds.serverUrl;

    // Switch to API Key mode visually
    currentAuthMode = 'apikey';
    $$('.auth-tab').forEach(t => t.classList.remove('active'));
    $(`.auth-tab[data-mode="apikey"]`).classList.add('active');
    $$('.auth-panel').forEach(p => p.classList.remove('active'));
    $('#auth-apikey').classList.add('active');

    setLoginState('loading', '凭证已解密，正在自动登录...');

    // Auto-login
    await handleApiKeyLogin();
  } catch (err) {
    console.error('Credential file decrypt error:', err);
    setLoginState('error', '解密失败：文件损坏或不是有效的加密凭证文件');
  }
}

function renderCredFileView() {
  const container = $('#view-credfile');
  container.innerHTML = `
    <div class="credfile-view">
      <div class="section-header">
        <span class="section-title">🔐 生成加密登录文件</span>
      </div>
      <p class="credfile-desc">
        输入你的登录信息，点击「生成加密文件」将下载一个 AES-256 加密的 <code>.bwcred</code> 文件。<br/>
        下次登录时，在登录页选择「🔐 加密文件」模式，拖拽文件即可自动登录。
      </p>
      <div class="credfile-form">
        <div class="form-group">
          <label>服务器</label>
          <select id="cred-server">
            <option value="">bitwarden.com（官方）</option>
            <option value="https://vault.bitwarden.eu">bitwarden.eu（欧洲）</option>
          </select>
        </div>
        <div class="form-group">
          <label>client_id</label>
          <input type="text" id="cred-client-id" placeholder="user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
        </div>
        <div class="form-group">
          <label>client_secret</label>
          <input type="password" id="cred-client-secret" placeholder="API secret" />
        </div>
        <div class="form-group">
          <label>邮箱</label>
          <input type="email" id="cred-email" placeholder="你的 Bitwarden 邮箱" />
        </div>
        <div class="form-group">
          <label>主密码</label>
          <input type="password" id="cred-password" placeholder="你的主密码" />
        </div>
        <button type="button" class="btn-primary" id="generate-credfile-btn">🔐 生成加密文件并下载</button>
      </div>
      <div class="credfile-security">
        <p>⚠️ 加密文件包含你的完整登录凭证，请妥善保管。仅本网站可解密。</p>
      </div>
    </div>
  `;

  // Pre-fill with current session data if available
  const curClientId = $('#client-id')?.value;
  const curSecret = $('#client-secret')?.value;
  const curEmail = $('#api-email')?.value;
  const curPassword = $('#api-password')?.value;
  const curServer = $('#server-url')?.value;

  if (curClientId) $('#cred-client-id').value = curClientId;
  if (curSecret) $('#cred-client-secret').value = curSecret;
  if (curEmail) $('#cred-email').value = curEmail;
  if (curPassword) $('#cred-password').value = curPassword;
  if (curServer) $('#cred-server').value = curServer;

  // Generate button
  $('#generate-credfile-btn').addEventListener('click', async () => {
    const data = {
      clientId: $('#cred-client-id').value.trim(),
      clientSecret: $('#cred-client-secret').value.trim(),
      email: $('#cred-email').value.trim(),
      password: $('#cred-password').value,
      serverUrl: $('#cred-server').value,
      createdAt: new Date().toISOString()
    };

    if (!data.clientId || !data.clientSecret || !data.email || !data.password) {
      showToast('❌ 请填写所有字段', 'error');
      return;
    }

    try {
      const encrypted = await encryptCredentials(data);
      const blob = new Blob([encrypted], { type: 'text/plain;charset=utf-8' });
      saveAs(blob, `vault-manager-${new Date().toISOString().slice(0, 10)}.bwcred`);
      showToast('✅ 加密凭证文件已下载', 'success');
    } catch (err) {
      console.error('Encrypt error:', err);
      showToast(`❌ 加密失败: ${err.message}`, 'error');
    }
  });
}
