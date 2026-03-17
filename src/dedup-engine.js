/**
 * Dedup Engine — Fusion Strategy
 * Analyzes decrypted vault items to find duplicates and orphans
 * Supports 3 scenarios: pure delete, complementary merge, deep merge
 */
import { t } from './i18n.js';

/**
 * Analyze ciphers and return duplicate groups + orphans
 * @param {Array} ciphers - Array of decrypted cipher objects
 * @returns {{ duplicateGroups: Array, orphans: Array, stats: Object }}
 */
export function analyzeCiphers(ciphers) {
  // Only analyze login type (type=1)
  const logins = ciphers.filter(c => c.type === 1);
  const others = ciphers.filter(c => c.type !== 1);

  const exactDupes = findExactDuplicates(logins);
  const sameSiteDupes = findSameSiteDuplicates(logins, exactDupes);
  const allDupeGroups = [...exactDupes, ...sameSiteDupes];
  const orphans = findOrphans(logins, allDupeGroups);

  const totalDuplicateItems = exactDupes.reduce((sum, g) => sum + g.items.length - 1, 0)
    + sameSiteDupes.reduce((sum, g) => sum + g.items.length - 1, 0);

  return {
    duplicateGroups: allDupeGroups,
    orphans,
    stats: {
      totalItems: ciphers.length,
      loginItems: logins.length,
      otherItems: others.length,
      exactDuplicateGroups: exactDupes.length,
      sameSiteDuplicateGroups: sameSiteDupes.length,
      totalDuplicateItems,
      orphanItems: orphans.length,
    },
  };
}

// ========================
// DEEP IDENTITY COMPARISON
// ========================

/**
 * Compare two decrypted items to determine if they are 100% identical
 * Compares ALL meaningful fields, not just URI+user+pass
 */
function isDeeplyIdentical(a, b) {
  const da = a.decrypted || {};
  const db = b.decrypted || {};

  // Core fields
  if (da.name !== db.name) return false;
  if (da.username !== db.username) return false;
  if (da.password !== db.password) return false;
  if (da.totp !== db.totp) return false;
  if ((da.notes || '') !== (db.notes || '')) return false;

  // URIs (compare sorted sets)
  const urisA = (da.uris || []).filter(Boolean).sort().join('|');
  const urisB = (db.uris || []).filter(Boolean).sort().join('|');
  if (urisA !== urisB) return false;

  // Custom fields
  const fieldsA = serializeFields(da.fields);
  const fieldsB = serializeFields(db.fields);
  if (fieldsA !== fieldsB) return false;

  // Passkeys (compare by CredentialId)
  const passkeysA = getPasskeyIds(a).sort().join('|');
  const passkeysB = getPasskeyIds(b).sort().join('|');
  if (passkeysA !== passkeysB) return false;

  // Favorite & Reprompt
  const favA = a.raw?.Favorite || a.raw?.favorite || false;
  const favB = b.raw?.Favorite || b.raw?.favorite || false;
  if (favA !== favB) return false;
  if ((da.reprompt || 0) !== (db.reprompt || 0)) return false;

  return true;
}

/**
 * Find specific differences between two items
 * Returns array of diff labels for UI display
 */
function findDiffFields(a, b) {
  const da = a.decrypted || {};
  const db = b.decrypted || {};
  const diffs = [];

  // Name
  if (da.name !== db.name) diffs.push(t('dup.title.warn'));

  // TOTP
  if (da.totp !== db.totp) diffs.push('TOTP');

  // Notes
  if ((da.notes || '') !== (db.notes || '')) diffs.push(t('detail.notes'));

  // URIs
  const urisA = new Set((da.uris || []).filter(Boolean));
  const urisB = new Set((db.uris || []).filter(Boolean));
  if (!setsEqual(urisA, urisB)) diffs.push('URI');

  // Custom fields
  if (serializeFields(da.fields) !== serializeFields(db.fields)) diffs.push(t('detail.section.fields'));

  // Passkeys
  const passkeysA = new Set(getPasskeyIds(a));
  const passkeysB = new Set(getPasskeyIds(b));
  if (!setsEqual(passkeysA, passkeysB)) diffs.push(t('detail.passkey'));

  // Favorite
  const favA = a.raw?.Favorite || a.raw?.favorite || false;
  const favB = b.raw?.Favorite || b.raw?.favorite || false;
  if (favA !== favB) diffs.push(t('detail.favorite'));

  // Reprompt
  if ((da.reprompt || 0) !== (db.reprompt || 0)) diffs.push(t('detail.reprompt'));

  return diffs;
}

/**
 * Analyze all pairwise differences in a group and return the union of diffs
 */
function analyzeGroupDiffs(items) {
  if (items.length < 2) return { pureDelete: true, diffFields: [] };

  const allDiffs = new Set();
  const base = items[0];
  for (let i = 1; i < items.length; i++) {
    const diffs = findDiffFields(base, items[i]);
    diffs.forEach(d => allDiffs.add(d));
  }

  return {
    pureDelete: allDiffs.size === 0,
    diffFields: [...allDiffs],
  };
}

// ========================
// DUPLICATE FINDING
// ========================

/**
 * Find exact duplicates: same URI + same username + same password
 * Now also marks pureDelete vs needsMerge based on deep comparison
 */
function findExactDuplicates(logins) {
  const groups = new Map();

  for (const login of logins) {
    const uri = getPrimaryUri(login);
    const username = login.decrypted?.username || '';
    const password = login.decrypted?.password || '';
    const key = `exact::${normalizeUri(uri)}::${username}::${password}`;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(login);
  }

  return Array.from(groups.values())
    .filter(g => g.length > 1)
    .map(items => {
      const sorted = sortByQuality(items);
      const { pureDelete, diffFields } = analyzeGroupDiffs(sorted);
      return {
        type: 'exact',
        label: `${t('dup.exact')}: ${sorted[0].decrypted?.name || getPrimaryUri(sorted[0])}`,
        matchKey: getPrimaryUri(sorted[0]),
        items: sorted,
        autoMergeable: true,
        pureDelete,
        needsMerge: !pureDelete,
        diffFields,
      };
    });
}

/**
 * Find same-site duplicates: same URI but different credentials
 * Excludes items already captured in exact duplicates
 */
function findSameSiteDuplicates(logins, exactDupes) {
  // Collect IDs already in exact duplicate groups
  const exactIds = new Set();
  for (const group of exactDupes) {
    for (const item of group.items) {
      exactIds.add(item.id);
    }
  }

  const groups = new Map();
  for (const login of logins) {
    const uri = normalizeUri(getPrimaryUri(login));
    if (!uri) continue;

    if (!groups.has(uri)) groups.set(uri, []);
    groups.get(uri).push(login);
  }

  return Array.from(groups.values())
    .filter(g => g.length > 1)
    // Only include groups where not ALL items are exact duplicates of each other
    .filter(g => {
      const nonExactCount = g.filter(i => !exactIds.has(i.id)).length;
      return nonExactCount > 0 || g.length > 1;
    })
    // Skip groups that are entirely covered by exact duplicate groups
    .filter(g => !g.every(i => exactIds.has(i.id)))
    .map(items => {
      const sorted = sortByQuality(items);
      const { pureDelete, diffFields } = analyzeGroupDiffs(sorted);
      return {
        type: 'same_site',
        label: `${t('dup.samesite')}: ${normalizeUri(getPrimaryUri(sorted[0]))}`,
        matchKey: normalizeUri(getPrimaryUri(sorted[0])),
        items: sorted,
        autoMergeable: false,
        pureDelete,
        needsMerge: !pureDelete,
        diffFields,
      };
    });
}

/**
 * Find orphan items: login items that appear in NO duplicate group
 * These are truly standalone entries with no duplicates anywhere
 */
function findOrphans(logins, allDupeGroups) {
  const dupeIds = new Set();
  for (const group of allDupeGroups) {
    for (const item of group.items) {
      dupeIds.add(item.id);
    }
  }
  return logins.filter(c => !dupeIds.has(c.id));
}

/**
 * Sort items by quality - best item first (the one to keep)
 * Priority: has passkeys > has TOTP > has custom fields > has notes > newest
 */
function sortByQuality(items) {
  return [...items].sort((a, b) => {
    // Has Fido2 credentials (passkeys)
    const aPasskeys = a.raw?.Login?.Fido2Credentials?.length || 0;
    const bPasskeys = b.raw?.Login?.Fido2Credentials?.length || 0;
    if (aPasskeys !== bPasskeys) return bPasskeys - aPasskeys;

    // Has TOTP
    const aTotp = a.decrypted?.totp ? 1 : 0;
    const bTotp = b.decrypted?.totp ? 1 : 0;
    if (aTotp !== bTotp) return bTotp - aTotp;

    // Has custom fields
    const aFields = a.decrypted?.fields?.length || 0;
    const bFields = b.decrypted?.fields?.length || 0;
    if (aFields !== bFields) return bFields - aFields;

    // Has notes
    const aNotes = a.decrypted?.notes?.length || 0;
    const bNotes = b.decrypted?.notes?.length || 0;
    if (aNotes !== bNotes) return bNotes - aNotes;

    // Newest revision date
    const aDate = new Date(a.raw?.RevisionDate || 0).getTime();
    const bDate = new Date(b.raw?.RevisionDate || 0).getTime();
    return bDate - aDate;
  });
}

// ========================
// MERGE OPERATIONS (Fusion Strategy)
// ========================

/**
 * Build merge operations from selected groups
 * Uses _original as base for encrypted-layer merge
 * Returns { toUpdate: [...], toDelete: [...], errors: [...] }
 * Each toUpdate item has: { id, data, titleOverride?, notesAppend? }
 *   titleOverride: new decrypted title string (needs re-encryption)
 *   notesAppend: text to append to decrypted notes (needs re-encryption)
 */
export function buildMergeOperations(selectedGroups) {
  const toCreate = [];  // Path B: new items to create (decrypted plaintext)
  const toUpdate = [];  // Path C: passkey items to update (encrypted _original)
  const toDelete = [];  // IDs to soft-delete
  const errors = [];

  for (const group of selectedGroups) {
    const keepItem = group.keepItem;
    const removeItems = group.items.filter(i => i.id !== keepItem.id);
    if (removeItems.length === 0) continue;

    // === Path A: Pure Delete (100% identical) ===
    if (group.pureDelete) {
      for (const item of removeItems) toDelete.push(item.id);
      continue;
    }

    // Check if any item has passkeys
    const hasPasskeys = group.items.some(i =>
      (i.raw?.Login?.Fido2Credentials?.length || 0) > 0
    );

    if (hasPasskeys) {
      // === Path C: Update passkey item (keep passkey holder, merge others into it) ===
      buildPathC_UpdatePasskeyItem(group, keepItem, removeItems, toUpdate, toDelete, errors);
    } else {
      // === Path B: Create-Then-Delete (no passkeys, safe to create new) ===
      buildPathB_CreateThenDelete(group, keepItem, removeItems, toCreate, toDelete, errors);
    }
  }

  return { toCreate, toUpdate, toDelete, errors };
}

/**
 * Path B: Create a new merged item from decrypted data, then delete all originals.
 * Outputs a toCreate entry with plaintext fields ready for encryption.
 */
function buildPathB_CreateThenDelete(group, keepItem, removeItems, toCreate, toDelete, errors) {
  const allItems = group.items;

  // === 1. Smart Title Selection ===
  const allNames = allItems.map(i => i.decrypted?.name || '').filter(Boolean);
  const uniqueNames = [...new Set(allNames)];
  const { chosen: bestTitle, discarded: discardedTitles } = chooseBestTitle(uniqueNames);

  // === 2. Notes: longest + append discarded titles ===
  let bestNotes = '';
  for (const item of allItems) {
    const n = item.decrypted?.notes || '';
    if (n.length > bestNotes.length) bestNotes = n;
  }
  if (discardedTitles.length > 0) {
    bestNotes = (bestNotes ? bestNotes + '\n' : '') + `合并前的其他标题: ${discardedTitles.join(', ')}`;
  }

  // === 3. Username & Password: from keepItem (highest quality) ===
  const username = keepItem.decrypted?.username || '';
  const password = keepItem.decrypted?.password || '';

  // === 4. TOTP: from whichever has it ===
  let totp = '';
  for (const item of allItems) {
    if (item.decrypted?.totp) { totp = item.decrypted.totp; break; }
  }

  // === 5. URIs: union of all unique URIs, with URL simplification ===
  const seenOrigins = new Set();
  const mergedUris = [];
  for (const item of allItems) {
    const uris = item.decrypted?.uris || [];
    for (const uri of uris) {
      if (!uri) continue;
      const simplified = simplifyUrl(uri);
      if (!seenOrigins.has(simplified)) {
        seenOrigins.add(simplified);
        mergedUris.push(simplified); // Use simplified URL
      }
    }
  }

  // === 6. Custom Fields: union by name ===
  const seenFieldNames = new Set();
  const mergedFields = [];
  for (const item of allItems) {
    const fields = item.decrypted?.fields || [];
    for (const f of fields) {
      const key = f.name || '';
      if (!seenFieldNames.has(key)) {
        seenFieldNames.add(key);
        mergedFields.push({ name: f.name || '', value: f.value || '', type: f.type ?? 0 });
      }
    }
  }

  // === 7. Favorite & Reprompt: OR of all ===
  const favorite = allItems.some(i => i.raw?.Favorite || i.raw?.favorite);
  const reprompt = allItems.some(i => (i.raw?.Reprompt ?? i.raw?.reprompt ?? 0) === 1) ? 1 : 0;

  // === 8. FolderId: from keepItem ===
  const folderId = keepItem.raw?.FolderId || keepItem.raw?.folderId || null;

  // === 9. Type: from keepItem (should be 1 for Login) ===
  const type = keepItem.raw?.Type ?? keepItem.raw?.type ?? 1;

  toCreate.push({
    groupLabel: group.label,
    type,
    name: bestTitle,
    notes: bestNotes || null,
    username,
    password,
    totp: totp || null,
    uris: mergedUris,
    fields: mergedFields.length > 0 ? mergedFields : null,
    folderId,
    favorite,
    reprompt,
    // PasswordHistory: merge from all items (raw encrypted, pass through)
    passwordHistory: collectPasswordHistory(allItems),
  });

  // Delete ALL originals (including keepItem — we're creating a new one)
  for (const item of allItems) {
    toDelete.push(item.id);
  }
}

/**
 * Path C: Merge data into the passkey-holding item via updateCipher.
 * The passkey item MUST be preserved (passkeys are tied to cipher Key).
 */
function buildPathC_UpdatePasskeyItem(group, keepItem, removeItems, toUpdate, toDelete, errors) {
  const base = keepItem.raw?._original;
  if (!base) {
    errors.push({
      groupLabel: group.label,
      reason: '缺少原始数据 (_original)，无法合并通行密钥条目，仅执行删除',
    });
    for (const item of removeItems) toDelete.push(item.id);
    return;
  }

  let needsUpdate = false;
  const updatedCipher = JSON.parse(JSON.stringify(base));
  const keepLogin = updatedCipher.Login || updatedCipher.login;

  // === Smart Title Selection ===
  const allNames = group.items.map(i => i.decrypted?.name || '').filter(Boolean);
  const uniqueNames = [...new Set(allNames)];
  let titleOverride = null;
  let notesAppend = null;

  if (uniqueNames.length > 1) {
    const { chosen, discarded } = chooseBestTitle(uniqueNames);
    if (chosen !== keepItem.decrypted?.name) {
      titleOverride = chosen;
      needsUpdate = true;
    }
    if (discarded.length > 0) {
      notesAppend = `\n合并前的其他标题: ${discarded.join(', ')}`;
      needsUpdate = true;
    }
  }

  for (const item of removeItems) {
    const removeRaw = item.raw?._original || item.raw;

    // 1. Merge URIs
    if (keepLogin && removeRaw?.Login) {
      const removeUris = removeRaw.Login.Uris || removeRaw.Login.uris || [];
      const existingUris = keepLogin.Uris || keepLogin.uris || [];
      const seenValues = new Set(existingUris.map(u => u.Uri || u.uri));
      const newUris = removeUris.filter(u => !seenValues.has(u.Uri || u.uri));
      if (newUris.length > 0) {
        const merged = [...existingUris, ...newUris];
        if (keepLogin.Uris !== undefined) keepLogin.Uris = merged;
        if (keepLogin.uris !== undefined) keepLogin.uris = merged;
        needsUpdate = true;
      }
    }

    // 2. Merge TOTP
    if (keepLogin && removeRaw?.Login) {
      const keepTotp = keepLogin.Totp || keepLogin.totp;
      const removeTotp = removeRaw.Login.Totp || removeRaw.Login.totp;
      if (!keepTotp && removeTotp) {
        if (keepLogin.Totp !== undefined) keepLogin.Totp = removeTotp;
        if (keepLogin.totp !== undefined) keepLogin.totp = removeTotp;
        needsUpdate = true;
      }
    }

    // 3. Merge custom fields
    const removeFields = removeRaw.Fields || removeRaw.fields || [];
    const existingFields = updatedCipher.Fields || updatedCipher.fields || [];
    if (removeFields.length > 0) {
      const seenNames = new Set(existingFields.map(f => f.Name || f.name));
      const newFields = removeFields.filter(f => !seenNames.has(f.Name || f.name));
      if (newFields.length > 0) {
        const merged = [...existingFields, ...newFields];
        updatedCipher.Fields = merged;
        if (updatedCipher.fields !== undefined) updatedCipher.fields = merged;
        needsUpdate = true;
      }
    }

    // 4. Merge notes (keep longer one)
    const keepNotes = updatedCipher.Notes || updatedCipher.notes || '';
    const removeNotes = removeRaw.Notes || removeRaw.notes || '';
    if (removeNotes && (!keepNotes || removeNotes.length > keepNotes.length)) {
      updatedCipher.Notes = removeNotes;
      if (updatedCipher.notes !== undefined) updatedCipher.notes = removeNotes;
      needsUpdate = true;
    }

    // 5. Merge Favorite
    const removeFav = removeRaw.Favorite || removeRaw.favorite;
    if (removeFav && !(updatedCipher.Favorite || updatedCipher.favorite)) {
      updatedCipher.Favorite = true;
      if (updatedCipher.favorite !== undefined) updatedCipher.favorite = true;
      needsUpdate = true;
    }

    // 6. Merge Reprompt
    const removeReprompt = removeRaw.Reprompt ?? removeRaw.reprompt ?? 0;
    const keepReprompt = updatedCipher.Reprompt ?? updatedCipher.reprompt ?? 0;
    if (removeReprompt === 1 && keepReprompt !== 1) {
      updatedCipher.Reprompt = 1;
      if (updatedCipher.reprompt !== undefined) updatedCipher.reprompt = 1;
      needsUpdate = true;
    }
  }

  if (needsUpdate) {
    if (keepLogin) {
      updatedCipher.Login = keepLogin;
      if (updatedCipher.login !== undefined) updatedCipher.login = keepLogin;
    }

    if (!updatedCipher.Name && !updatedCipher.name) {
      errors.push({
        groupLabel: group.label,
        reason: '合并后缺少 Name 字段，跳过更新',
      });
    } else {
      toUpdate.push({
        id: keepItem.id,
        data: updatedCipher,
        titleOverride,
        notesAppend,
        uriOptimizations: null,  // Path C doesn't do URI optimization (encrypted data)
      });
    }
  }

  // Delete remove items (NOT keepItem — it holds the passkeys)
  for (const item of removeItems) {
    toDelete.push(item.id);
  }
}

/**
 * Collect password history from all items (raw encrypted, pass through)
 */
function collectPasswordHistory(allItems) {
  const history = [];
  const seen = new Set();
  for (const item of allItems) {
    const ph = item.raw?._original?.PasswordHistory || item.raw?.PasswordHistory || [];
    for (const h of ph) {
      const key = (h.Password || h.password || '') + '|' + (h.LastUsedDate || h.lastUsedDate || '');
      if (!seen.has(key)) {
        seen.add(key);
        history.push(h);
      }
    }
  }
  return history.length > 0 ? history : null;
}

/**
 * Simplify URL to just protocol://hostname
 */
function simplifyUrl(url) {
  try {
    const u = new URL(url);
    // Use registered domain for a canonical origin
    const cleanHost = getRegisteredDomain(u.hostname.toLowerCase());
    return `${u.protocol}//${cleanHost}`;
  } catch {
    return url;
  }
}

/**
 * Choose the best title from a list of unique titles
 * Rules:
 *   1. Same titles → no change needed (handled by caller)
 *   2. Chinese title + English title → keep Chinese, discard English
 *   3. Two English titles → keep shorter one, discard longer
 * @returns {{ chosen: string, discarded: string[] }}
 */
function chooseBestTitle(titles) {
  if (titles.length === 1) return { chosen: titles[0], discarded: [] };

  // Classify each title
  const classified = titles.map(t => ({
    title: t,
    hasChinese: /[\u4e00-\u9fff\u3400-\u4dbf]/.test(t),
  }));

  const chinese = classified.filter(c => c.hasChinese);
  const nonChinese = classified.filter(c => !c.hasChinese);

  let chosen;
  let discarded;

  if (chinese.length > 0) {
    // Prefer Chinese title; if multiple, pick the shortest
    chinese.sort((a, b) => a.title.length - b.title.length);
    chosen = chinese[0].title;
    discarded = titles.filter(t => t !== chosen);
  } else {
    // All non-Chinese: pick the shortest
    nonChinese.sort((a, b) => a.title.length - b.title.length);
    chosen = nonChinese[0].title;
    discarded = titles.filter(t => t !== chosen);
  }

  return { chosen, discarded };
}

// ========================
// HELPERS
// ========================

function getPrimaryUri(cipher) {
  if (cipher.decrypted?.uris && cipher.decrypted.uris.length > 0) {
    return cipher.decrypted.uris[0] || '';
  }
  return '';
}

/**
 * Known multi-part TLDs (eTLD list subset).
 * For hostnames ending in these, the registered domain is the part before + the TLD.
 * e.g., "shop.example.co.uk" → "example.co.uk"
 */
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'ne.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw',
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk',
  'co.nz', 'net.nz', 'org.nz',
  'com.br', 'org.br', 'net.br',
  'com.mx', 'org.mx', 'net.mx',
  'co.in', 'net.in', 'org.in',
  'com.sg', 'org.sg', 'net.sg', 'edu.sg', 'gov.sg',
  'co.za', 'org.za', 'net.za',
  'co.il', 'org.il', 'net.il',
  'com.tr', 'org.tr', 'net.tr',
  'co.th', 'or.th', 'ac.th',
  'com.vn', 'net.vn', 'org.vn',
  'com.ar', 'org.ar', 'net.ar',
]);

/**
 * Extract registered domain (eTLD+1) from a hostname.
 * "pan.baidu.com" → "baidu.com"
 * "shop.example.co.uk" → "example.co.uk"
 * "baidu.com" → "baidu.com"  (already a base domain)
 */
function getRegisteredDomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname; // already base domain or single-label

  // Check if the last two parts form a known multi-part TLD
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) {
    // Need 3 parts: "example.co.uk"
    return parts.slice(-3).join('.');
  }

  // Standard TLD: take last 2 parts ("baidu.com")
  return parts.slice(-2).join('.');
}

function normalizeUri(uri) {
  if (!uri) return '';
  try {
    // Handle mobile app URIs: androidapp://com.example.app, iosapp://com.example.app
    const appMatch = uri.match(/^(androidapp|iosapp):\/\/(.+)/i);
    if (appMatch) {
      return appMatch[2].toLowerCase().split('/')[0].trim();
    }
    const u = new URL(uri.startsWith('http') ? uri : `https://${uri}`);
    return getRegisteredDomain(u.hostname.toLowerCase());
  } catch {
    return uri.toLowerCase().trim();
  }
}

function serializeFields(fields) {
  if (!fields || fields.length === 0) return '';
  return fields
    .map(f => `${f.name || ''}::${f.value || ''}::${f.type ?? 0}`)
    .sort()
    .join('||');
}

function getPasskeyIds(cipher) {
  const creds = cipher.raw?.Login?.Fido2Credentials || cipher.raw?.login?.fido2Credentials || [];
  return creds.map(p => p.CredentialId || p.credentialId || '').filter(Boolean);
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}
