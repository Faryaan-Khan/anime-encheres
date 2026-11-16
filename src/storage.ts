/**
 * localStorage can be missing or throw (private browsing, embedded previews),
 * so every access is guarded and falls back to memory for the session.
 */
const memory = new Map<string, string>();

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeStored(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* kept in memory only */
  }
}

export function removeStored(key: string): void {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to remove */
  }
}
