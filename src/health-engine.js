/**
 * Vault Health Analysis Engine
 * Detects weak passwords, password reuse, stale entries, insecure URIs, etc.
 */
import { t } from './i18n.js';

/**
 * Analyze vault health and return a scored report
 * @param {Array} ciphers - Decrypted cipher objects
 * @returns {{ score: number, issues: Array, summary: Object }}
 */
export function analyzeHealth(ciphers) {
  const logins = ciphers.filter(c => c.type === 1);
  const issues = [];

  // 1. Weak passwords
  const weak = logins.filter(c => {
    const pw = c.decrypted?.password;
    if (!pw) return false;
    return pw.length < 8 || /^\d+$/.test(pw) || /^[a-zA-Z]+$/.test(pw);
  });
  if (weak.length) issues.push({ id: 'weak-pw', severity: 'high', label: t('health.weak'), count: weak.length, items: weak });

  // 2. Empty passwords (exclude items with passkeys — passkey IS the credential)
  const empty = logins.filter(c => (!c.decrypted?.password || c.decrypted.password.trim() === '') && !(c.raw?.Login?.Fido2Credentials?.length > 0));
  if (empty.length) issues.push({ id: 'empty-pw', severity: 'high', label: t('health.empty.pw'), count: empty.length, items: empty });

  // 3. Password reuse
  const pwMap = new Map();
  for (const c of logins) {
    const pw = c.decrypted?.password;
    if (!pw || pw.trim() === '') continue;
    if (!pwMap.has(pw)) pwMap.set(pw, []);
    pwMap.get(pw).push(c);
  }
  const reused = Array.from(pwMap.values()).filter(g => g.length > 1);
  const reusedCount = reused.reduce((sum, g) => sum + g.length, 0);
  if (reused.length) issues.push({ id: 'reused-pw', severity: 'medium', label: t('health.reused'), count: reusedCount, groups: reused });

  // 4. Stale passwords (>1 year old)
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const stale = logins.filter(c => {
    const date = new Date(c.raw?.RevisionDate || 0).getTime();
    return date > 0 && date < oneYearAgo;
  });
  if (stale.length) issues.push({ id: 'stale', severity: 'medium', label: t('health.stale'), count: stale.length, items: stale });

  // 5. HTTP URIs
  const httpItems = logins.filter(c => {
    const uris = c.decrypted?.uris || [];
    return uris.some(u => u && u.startsWith('http://'));
  });
  if (httpItems.length) issues.push({ id: 'http', severity: 'medium', label: t('health.http'), count: httpItems.length, items: httpItems });

  // 6. No URL
  const noUrl = logins.filter(c => !c.decrypted?.uris || c.decrypted.uris.filter(Boolean).length === 0);
  if (noUrl.length) issues.push({ id: 'no-url', severity: 'low', label: t('health.nourl'), count: noUrl.length, items: noUrl });

  // 7. No name
  const noName = ciphers.filter(c => !c.decrypted?.name || c.decrypted.name.trim() === '');
  if (noName.length) issues.push({ id: 'no-name', severity: 'low', label: t('health.notitle'), count: noName.length, items: noName });

  // Calculate score (100 = perfect)
  const highCount = issues.filter(i => i.severity === 'high').reduce((s, i) => s + i.count, 0);
  const medCount = issues.filter(i => i.severity === 'medium').reduce((s, i) => s + i.count, 0);
  const lowCount = issues.filter(i => i.severity === 'low').reduce((s, i) => s + i.count, 0);
  const total = logins.length || 1;
  const penalty = (highCount * 3 + medCount * 1.5 + lowCount * 0.5) / total * 25;
  const score = Math.max(0, Math.round(100 - penalty));

  return {
    score,
    issues,
    summary: {
      total: ciphers.length,
      logins: logins.length,
      healthy: logins.length - highCount - medCount,
      highRisk: highCount,
      mediumRisk: medCount,
      lowRisk: lowCount,
    },
  };
}
