/**
 * Light and dark themes. The choice is remembered; with no choice the page
 * follows the device setting. The theme is applied before the first render
 * (see main.tsx) so the page never flashes the wrong colours.
 */
import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from './storage';

export type Theme = 'light' | 'dark';

const KEY = 'ae.theme';
const listeners = new Set<() => void>();

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

let current: Theme = (readStored(KEY) as Theme | null) ?? systemTheme();

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121317' : '#eceee8');
}

export function initTheme(): void {
  apply(current);
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (readStored(KEY)) return;
      current = systemTheme();
      apply(current);
      listeners.forEach((l) => l());
    });
  } catch {
    /* older browsers: no live updates */
  }
}

export function setTheme(theme: Theme): void {
  current = theme;
  writeStored(KEY, theme);
  apply(theme);
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
