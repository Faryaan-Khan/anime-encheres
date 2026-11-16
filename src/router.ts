import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'local' }
  | { name: 'solo' }
  | { name: 'online' }
  | { name: 'rules' }
  | { name: 'room'; code: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'local') return { name: 'local' };
  if (parts[0] === 'solo') return { name: 'solo' };
  if (parts[0] === 'online') return { name: 'online' };
  if (parts[0] === 'rules') return { name: 'rules' };
  if (parts[0] === 'room' && parts[1]) {
    const code = parts[1].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (code.length === 5) return { name: 'room', code };
  }
  return { name: 'home' };
}

export function navigate(path: string): void {
  window.location.hash = path;
}

/** Tiny hash router: works on any static host with no server configuration. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
