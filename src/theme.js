/**
 * Theme — Light/Dark mode module
 * Auto-detects OS preference, persists user choice
 */

let currentTheme = 'dark';

export function getTheme() {
  return currentTheme;
}

export function setTheme(mode) {
  if (mode !== 'light' && mode !== 'dark') return;
  currentTheme = mode;
  localStorage.setItem('bw-theme', mode);
  document.documentElement.setAttribute('data-theme', mode);
  window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme: mode } }));
}

export function toggleTheme() {
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  const saved = localStorage.getItem('bw-theme');
  if (saved && (saved === 'light' || saved === 'dark')) {
    currentTheme = saved;
  } else {
    currentTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', currentTheme);

  // Listen for OS theme changes (only if user hasn't manually set a preference)
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!localStorage.getItem('bw-theme')) {
      setTheme(e.matches ? 'light' : 'dark');
    }
  });
}
