import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameView } from '../game/types';
import {
  OnlineError,
  getClient,
  getRoom,
  joinRoom,
  play,
  startGame,
  toOnlineError,
  type OnlineErrorCode,
  type PlayAction,
} from './api';

const POLL_MS = 2500;

export interface OnlineRoom {
  view: GameView | null;
  /** Set when the room could not be loaded at all (wrong code, not a member…). */
  loadError: OnlineErrorCode | null;
  /** Set when the last action was refused. */
  actionError: OnlineErrorCode | null;
  busy: boolean;
  join(name: string): Promise<void>;
  start(): Promise<void>;
  act(action: PlayAction, amount?: number): Promise<void>;
}

/**
 * Keeps one room in sync.
 *
 * The server is the single source of truth. After every action the player
 * pings the other device over a Realtime broadcast channel, and both devices
 * also poll every few seconds so a missed ping never leaves a screen stale.
 * The ping carries no game data: each device re-reads its own view, which is
 * the only place the hidden card is ever filtered.
 */
export function useOnlineRoom(code: string): OnlineRoom {
  const [view, setView] = useState<GameView | null>(null);
  const [loadError, setLoadError] = useState<OnlineErrorCode | null>(null);
  const [actionError, setActionError] = useState<OnlineErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const memberRef = useRef(false);

  /** Never lets an older response overwrite a newer one. */
  const accept = useCallback((next: GameView) => {
    memberRef.current = true;
    setLoadError(null);
    setView((prev) => (!prev || next.version >= prev.version ? next : prev));
  }, []);

  const refresh = useCallback(async () => {
    try {
      accept(await getRoom(code));
    } catch (error) {
      const err = toOnlineError(error);
      // A blip while playing is not worth interrupting the game for.
      if (!memberRef.current || err.code === 'ROOM_NOT_FOUND' || err.code === 'NOT_IN_ROOM') {
        memberRef.current = false;
        setView(null);
        setLoadError(err.code);
      }
    }
  }, [accept, code]);

  const notify = useCallback(() => {
    void channelRef.current?.send({ type: 'broadcast', event: 'sync', payload: {} });
  }, []);

  useEffect(() => {
    setView(null);
    setLoadError(null);
    setActionError(null);
    memberRef.current = false;
    void refresh();

    const channel = getClient()
      .channel(`room:${code}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'sync' }, () => void refresh())
      .subscribe();
    channelRef.current = channel;

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && memberRef.current) void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && memberRef.current) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      channelRef.current = null;
      void getClient().removeChannel(channel);
    };
  }, [code, refresh]);

  const run = useCallback(
    async (request: () => Promise<GameView>, harmless: OnlineErrorCode[] = []) => {
      setBusy(true);
      setActionError(null);
      try {
        accept(await request());
        notify();
      } catch (error) {
        const err = error instanceof OnlineError ? error : toOnlineError(error);
        if (!harmless.includes(err.code)) setActionError(err.code);
        // The screen was probably stale: bring it up to date.
        if (memberRef.current) void refresh();
      } finally {
        setBusy(false);
      }
    },
    [accept, notify, refresh],
  );

  const join = useCallback((name: string) => run(() => joinRoom(code, name)), [code, run]);
  const start = useCallback(() => run(() => startGame(code)), [code, run]);
  const act = useCallback(
    (action: PlayAction, amount?: number) =>
      // Both players may press "next" on the same reveal; the second press
      // finds the round already advanced, which is not worth an error message.
      run(() => play(code, action, amount), action === 'next' ? ['WRONG_PHASE'] : []),
    [code, run],
  );

  return { view, loadError, actionError, busy, join, start, act };
}
