import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeSnapshot } from "./viewModel.js";

function readSnapshot(session) {
  try {
    return session?.getSnapshot?.() || {};
  } catch (error) {
    return { connection: { state: "ERROR" }, error };
  }
}

export function useLiveSession(session) {
  const [snapshot, setSnapshot] = useState(() => readSnapshot(session));
  const [pendingCommand, setPendingCommand] = useState(null);
  const [commandError, setCommandError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setSnapshot(readSnapshot(session));
    const refresh = (nextSnapshot) => {
      if (!mounted.current) return;
      setSnapshot(nextSnapshot && typeof nextSnapshot === "object" && !Array.isArray(nextSnapshot)
        ? nextSnapshot
        : readSnapshot(session));
    };
    const unsubscribe = session?.subscribe?.(refresh);
    return () => {
      mounted.current = false;
      if (typeof unsubscribe === "function") unsubscribe();
      else unsubscribe?.unsubscribe?.();
    };
  }, [session]);

  const send = useCallback(async (command) => {
    if (!session?.send) throw new Error("LiveGameApp 需要传入具有 send(command) 的 session");
    setPendingCommand(command);
    setCommandError(null);
    try {
      const result = await session.send(command);
      if (result?.ok === false) {
        const error = new Error(result.message || "操作没有成功，请重试");
        error.code = result.code;
        error.retryable = result.retryable;
        throw error;
      }
      if (mounted.current) {
        const next = result?.snapshot || result?.view || (result?.status || result?.phase ? result : null);
        setSnapshot(next || readSnapshot(session));
      }
      return result;
    } catch (error) {
      if (mounted.current) setCommandError(error);
      throw error;
    } finally {
      if (mounted.current) setPendingCommand(null);
    }
  }, [session]);

  const view = useMemo(() => normalizeSnapshot(snapshot), [snapshot]);
  return { snapshot, view, send, pendingCommand, commandError, refresh: () => setSnapshot(readSnapshot(session)) };
}

export function useDeadline(deadline) {
  const calculate = () => {
    if (!deadline) return null;
    const at = typeof deadline === "number" ? deadline : Date.parse(deadline);
    return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
  };
  const [remaining, setRemaining] = useState(calculate);
  useEffect(() => {
    setRemaining(calculate());
    if (!deadline) return undefined;
    const timer = window.setInterval(() => setRemaining(calculate()), 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return remaining;
}
