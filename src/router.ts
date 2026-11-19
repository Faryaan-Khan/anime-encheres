import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'local' }
  | { name: 'solo' }
  | { name: 'match' }
  | { name: 'profile' }
  | { name: 'leaderboard' }
  | { name: 'feedback' }
  | { name: 'friends' }
  | { name: 'legal' }
  | { name: 'online' }
  | { name: 'rules' }
  | { name: 'characters' }
  | { name: 'room'; code: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  if (parts[0] === 'local') return { name: 'local' };
  if (parts[0] === 'solo') return { name: 'solo' };
  if (parts[0] === 'match') return { name: 'match' };
  if (parts[0] === 'profile') return { name: 'profile' };
  if (parts[0] === 'leaderboard') return { name: 'leaderboard' };
  if (parts[0] === 'feedback') return { name: 'feedback' };
  if (parts[0] === 'friends') return { name: 'friends' };
  if (parts[0] === 'legal') return { name: 'legal' };
  if (parts[0] === 'online') return { name: 'online' };
  if (parts[0] === 'rules') return { name: 'rules' };
  if (parts[0] === 'characters') return { name: 'characters' };
  if (parts[0] === 'room' && parts[1]) {
    const code = parts[1].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (code.length === 5) return { name: 'room', code };
  }
  return { name: 'home' };
}

/** Set while a change of page comes from the app itself, not the browser's back or forward. */
let fromApp = false;

export function navigate(path: string): void {
  fromApp = true;
  // A change to the page already shown fires no event: clear the flag anyway.
  window.setTimeout(() => (fromApp = false), 0);
  window.location.hash = path;
}

/**
 * While locked, the browser's back and forward (and the phone's back gesture)
 * cannot leave the page shown: it is put straight back. Pages the app itself
 * opens (navigate) are not held. See chrome.ts.
 */
let lockedOn: string | null = null;

export function lockNavigation(on: boolean): void {
  lockedOn = on ? pathOf(window.location.hash) : null;
}

/**
 * The pages visited in this tab, oldest first, so that "Back" can return to
 * the page before (and say "Home" when there is none). Kept for the tab's
 * life, so a reload keeps it.
 */
const TRAIL_KEY = 'ae.trail';
const pathOf = (hash: string) => hash.replace(/^#/, '') || '/';

function readTrail(): string[] {
  try {
    const trail = JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? '[]');
    return Array.isArray(trail) ? trail.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

let trail: string[] = readTrail();

function saveTrail() {
  try {
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail.slice(-50)));
  } catch {
    /* private mode: kept in memory */
  }
}

/** Records the page now shown: going back pops the trail, anything else adds to it. */
function visit(path: string) {
  if (trail[trail.length - 1] === path) return;
  if (trail[trail.length - 2] === path) trail = trail.slice(0, -1);
  else trail = [...trail, path];
  saveTrail();
}

/** The page before this one in the tab, or null when this is the first. */
export function previousPage(): string | null {
  return trail.length >= 2 ? trail[trail.length - 2] : null;
}

/** Back to the previous page, or home when there is none. */
export function goBack(): void {
  if (previousPage() !== null) window.history.back();
  else navigate('/');
}

/** Tiny hash router: works on any static host with no server configuration. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => {
    visit(pathOf(window.location.hash));
    return parseRoute(window.location.hash);
  });
  useEffect(() => {
    const onChange = () => {
      const path = pathOf(window.location.hash);
      if (lockedOn !== null && !fromApp && path !== lockedOn) {
        // Held: back to the game, as if the gesture had not happened.
        window.location.hash = lockedOn;
        return;
      }
      fromApp = false;
      visit(path);
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
