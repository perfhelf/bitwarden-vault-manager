/**
 * Search & Filter Engine
 * Provides real-time search and quick-filter capabilities across decrypted vault items
 */

/**
 * Quick filter definitions
 */
export const QUICK_FILTERS = [
  { id: 'no-url',      labelKey: 'filter.no.url',      icon: '🔗', test: c => c.type === 1 && (!c.decrypted?.uris || c.decrypted.uris.filter(Boolean).length === 0) },
  { id: 'no-name',     labelKey: 'filter.no.name',     icon: '📝', test: c => !c.decrypted?.name || c.decrypted.name.trim() === '' },
  { id: 'no-folder',   labelKey: 'filter.no.folder',   icon: '📂', test: c => !c.raw?.FolderId },
  { id: 'has-passkey', labelKey: 'filter.has.passkey', icon: '🔑', test: c => (c.raw?.Login?.Fido2Credentials?.length || 0) > 0 },
  { id: 'has-totp',    labelKey: 'filter.has.totp',    icon: '🕐', test: c => !!c.decrypted?.totp },
  { id: 'weak-pw',     labelKey: 'filter.weak.pw',     icon: '⚠️', test: c => {
    const pw = c.decrypted?.password;
    if (!pw || c.type !== 1) return false;
    return pw.length < 8 || /^\d+$/.test(pw) || /^[a-zA-Z]+$/.test(pw);
  }},
  { id: 'empty-pw',    labelKey: 'filter.empty.pw',    icon: '🚫', test: c => c.type === 1 && (!c.decrypted?.password || c.decrypted.password.trim() === '') && !(c.raw?.Login?.Fido2Credentials?.length > 0) },
  { id: 'http-uri',    labelKey: 'filter.http.uri',    icon: '🔓', test: c => {
    const uris = c.decrypted?.uris || [];
    return uris.some(u => u && u.startsWith('http://'));
  }},
  { id: 'decrypt-fail', labelKey: 'filter.decrypt.fail', icon: '💀', test: c => !!c.decrypted?.error },
];

/**
 * Type filter options
 */
export const TYPE_FILTERS = [
  { id: 'all',      labelKey: 'type.all', type: null },
  { id: 'login',    labelKey: 'type.login', type: 1 },
  { id: 'card',     labelKey: 'type.card', type: 3 },
  { id: 'identity', labelKey: 'type.identity', type: 4 },
  { id: 'note',     labelKey: 'type.note', type: 2 },
];

/**
 * Sort options
 */
export const SORT_OPTIONS = [
  { id: 'name-asc',  labelKey: 'sort.name.asc',  fn: (a, b) => (a.decrypted?.name || '').localeCompare(b.decrypted?.name || '') },
  { id: 'name-desc', labelKey: 'sort.name.desc', fn: (a, b) => (b.decrypted?.name || '').localeCompare(a.decrypted?.name || '') },
  { id: 'date-desc', labelKey: 'sort.date.desc', fn: (a, b) => new Date(b.raw?.RevisionDate || 0) - new Date(a.raw?.RevisionDate || 0) },
  { id: 'date-asc',  labelKey: 'sort.date.asc',  fn: (a, b) => new Date(a.raw?.RevisionDate || 0) - new Date(b.raw?.RevisionDate || 0) },
];

/**
 * Search + filter ciphers
 * @param {Array} ciphers - All decrypted cipher objects
 * @param {Object} opts - { query, activeFilters: Set<string>, typeFilter: number|null, sortId: string }
 * @returns {Array} Filtered and sorted ciphers
 */
export function searchAndFilter(ciphers, opts = {}) {
  const { query = '', activeFilters = new Set(), typeFilter = null, sortId = 'name-asc' } = opts;
  let results = [...ciphers];

  // Type filter
  if (typeFilter !== null) {
    results = results.filter(c => c.type === typeFilter);
  }

  // Quick filters (AND logic — all active filters must match)
  for (const filterId of activeFilters) {
    const filter = QUICK_FILTERS.find(f => f.id === filterId);
    if (filter) {
      results = results.filter(filter.test);
    }
  }

  // Text search (across name, username, URIs, notes)
  if (query.trim()) {
    const q = query.toLowerCase().trim();
    results = results.filter(c => {
      const name = (c.decrypted?.name || '').toLowerCase();
      const username = (c.decrypted?.username || '').toLowerCase();
      const notes = (c.decrypted?.notes || '').toLowerCase();
      const uris = (c.decrypted?.uris || []).join(' ').toLowerCase();
      return name.includes(q) || username.includes(q) || uris.includes(q) || notes.includes(q);
    });
  }

  // Sort
  const sortOption = SORT_OPTIONS.find(s => s.id === sortId);
  if (sortOption) {
    results.sort(sortOption.fn);
  }

  return results;
}

/**
 * Get filter counts for badge display
 */
export function getFilterCounts(ciphers) {
  const counts = {};
  for (const f of QUICK_FILTERS) {
    counts[f.id] = ciphers.filter(f.test).length;
  }
  return counts;
}
