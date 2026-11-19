/**
 * Immersive mode: during an online game the top bar (Back, sound, theme,
 * language) is hidden and the browser's back gesture is held (router.ts), so
 * nothing takes the player out of the game by accident. The game's own Quit or
 * Forfeit still works, and the bar returns with the results.
 */
import { useSyncExternalStore } from 'react';
import { lockNavigation } from './router';

let immersive = false;
const listeners = new Set<() => void>();

export function setImmersive(on: boolean): void {
  if (immersive === on) return;
  immersive = on;
  lockNavigation(on);
  listeners.forEach((l) => l());
}

export function useImmersive(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => immersive,
    () => immersive,
  );
}
