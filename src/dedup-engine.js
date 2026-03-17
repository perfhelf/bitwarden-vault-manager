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
  const toUpdate = [];
  const toDelete = [];
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

    // === Path B: Fusion Merge (has differences) ===
    const base = keepItem.raw?._original;
    if (!base) {
      // No _original available → can only delete, warn user
      errors.push({
        groupLabel: group.label,
        reason: '缺少原始数据 (_original)，无法合并，仅执行删除',
      });
      for (const item of removeItems) toDelete.push(item.id);
      continue;
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

      // 1. Merge passkeys (Fido2Credentials)
      if (keepLogin && removeRaw?.Login?.Fido2Credentials?.length > 0) {
        const existing = keepLogin.Fido2Credentials || keepLogin.fido2Credentials || [];
        const seenIds = new Set(existing.map(p => p.CredentialId || p.credentialId));
        const newPasskeys = (removeRaw.Login.Fido2Credentials || []).filter(
          p => !seenIds.has(p.CredentialId || p.credentialId)
        );
        if (newPasskeys.length > 0) {
          const merged = [...existing, ...newPasskeys];
          if (keepLogin.Fido2Credentials !== undefined) keepLogin.Fido2Credentials = merged;
          if (keepLogin.fido2Credentials !== undefined) keepLogin.fido2Credentials = merged;
          needsUpdate = true;
        }
      }

      // 2. Merge URIs (combine unique by encrypted value)
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

      // 3. Merge TOTP (keep if either has it)
      if (keepLogin && removeRaw?.Login) {
        const keepTotp = keepLogin.Totp || keepLogin.totp;
        const removeTotp = removeRaw.Login.Totp || removeRaw.Login.totp;
        if (!keepTotp && removeTotp) {
          if (keepLogin.Totp !== undefined) keepLogin.Totp = removeTotp;
          if (keepLogin.totp !== undefined) keepLogin.totp = removeTotp;
          needsUpdate = true;
        }
      }

      // 4. Merge custom fields (combine unique by encrypted name)
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

      // 5. Merge notes (keep longer one)
      const keepNotes = updatedCipher.Notes || updatedCipher.notes || '';
      const removeNotes = removeRaw.Notes || removeRaw.notes || '';
      if (removeNotes && (!keepNotes || removeNotes.length > keepNotes.length)) {
        updatedCipher.Notes = removeNotes;
        if (updatedCipher.notes !== undefined) updatedCipher.notes = removeNotes;
        needsUpdate = true;
      }

      // 6. Merge Favorite (any true → keep true)
      const removeFav = removeRaw.Favorite || removeRaw.favorite;
      if (removeFav && !(updatedCipher.Favorite || updatedCipher.favorite)) {
        updatedCipher.Favorite = true;
        if (updatedCipher.favorite !== undefined) updatedCipher.favorite = true;
        needsUpdate = true;
      }

      // 7. Merge Reprompt (any 1 → keep 1)
      const removeReprompt = removeRaw.Reprompt ?? removeRaw.reprompt ?? 0;
      const keepReprompt = updatedCipher.Reprompt ?? updatedCipher.reprompt ?? 0;
      if (removeReprompt === 1 && keepReprompt !== 1) {
        updatedCipher.Reprompt = 1;
        if (updatedCipher.reprompt !== undefined) updatedCipher.reprompt = 1;
        needsUpdate = true;
      }
    }

    // === 8. URI Domain Dedup: keep only shortest URL per domain ===
    if (keepLogin) {
      const currentUris = keepLogin.Uris || keepLogin.uris || [];
      if (currentUris.length > 1) {
        // Build encrypted→decrypted URI mapping from all group items
        const encToDecMap = new Map();
        for (const item of group.items) {
          const decUris = item.decrypted?.uris || [];
          const rawLogin = item.raw?._original?.Login || item.raw?._original?.login || item.raw?.Login || item.raw?.login || {};
          const rawUris = rawLogin.Uris || rawLogin.uris || [];
          for (let k = 0; k < Math.min(decUris.length, rawUris.length); k++) {
            const encVal = rawUris[k]?.Uri || rawUris[k]?.uri || '';
            const decVal = decUris[k] || '';
            if (encVal && decVal) encToDecMap.set(encVal, decVal);
          }
        }

        // Group URIs by origin (protocol + host)
        const getOrigin = (url) => {
          try { return new URL(url).origin; } catch { return url; }
        };

        const byOrigin = new Map(); // origin → [{encUri, decUri, uriObj, len}]
        for (const uriObj of currentUris) {
          const encVal = uriObj.Uri || uriObj.uri || '';
          const decVal = encToDecMap.get(encVal) || '';
          const origin = decVal ? getOrigin(decVal) : encVal;
          if (!byOrigin.has(origin)) byOrigin.set(origin, []);
          byOrigin.get(origin).push({ uriObj, decVal, len: decVal.length || 999 });
        }

        // For each origin with multiple URIs, keep only the shortest
        const deduped = [];
        for (const [, entries] of byOrigin) {
          if (entries.length > 1) {
            entries.sort((a, b) => a.len - b.len);
            deduped.push(entries[0].uriObj); // keep shortest
            needsUpdate = true;
          } else {
            deduped.push(entries[0].uriObj);
          }
        }

        if (deduped.length < currentUris.length) {
          if (keepLogin.Uris !== undefined) keepLogin.Uris = deduped;
          if (keepLogin.uris !== undefined) keepLogin.uris = deduped;
        }
      }
    }

    if (needsUpdate) {
      if (keepLogin) {
        updatedCipher.Login = keepLogin;
        if (updatedCipher.login !== undefined) updatedCipher.login = keepLogin;
      }

      // Validate critical fields exist before submitting
      if (!updatedCipher.Name && !updatedCipher.name) {
        errors.push({
          groupLabel: group.label,
          reason: '合并后缺少 Name 字段，跳过更新',
        });
      } else {
        toUpdate.push({
          id: keepItem.id,
          data: updatedCipher,
          titleOverride,    // null or new decrypted title
          notesAppend,      // null or text to append
        });
      }
    }

    // Mark remove items for deletion
    for (const item of removeItems) {
      toDelete.push(item.id);
    }
  }

  return { toUpdate, toDelete, errors };
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

function normalizeUri(uri) {
  if (!uri) return '';
  try {
    const u = new URL(uri.startsWith('http') ? uri : `https://${uri}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return uri.toLowerCase().replace(/^www\./, '').trim();
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
