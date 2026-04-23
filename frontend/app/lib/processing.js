import { createContext, useCallback, useContext, useMemo, useState } from "react";

const ProcessingContext = createContext(null);

export function ProcessingProvider({ children }) {
  const [state, setState] = useState({ active: false, message: "", percent: null });

  const start = useCallback((message) => {
    setState({ active: true, message: String(message ?? "Processing…"), percent: null });
  }, []);

  const setPercent = useCallback((percent) => {
    const n = Number(percent);
    setState((s) => ({ ...s, active: true, percent: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null }));
  }, []);

  const setMessage = useCallback((message) => {
    setState((s) => ({ ...s, active: true, message: String(message ?? s.message ?? "Processing…") }));
  }, []);

  const stop = useCallback(() => {
    setState({ active: false, message: "", percent: null });
  }, []);

  const value = useMemo(() => ({ state, start, setPercent, setMessage, stop }), [state, start, setMessage, setPercent, stop]);
  return <ProcessingContext.Provider value={value}>{children}</ProcessingContext.Provider>;
}

export function useProcessing() {
  const ctx = useContext(ProcessingContext);
  if (!ctx) throw new Error("useProcessing must be used within ProcessingProvider");
  return ctx;
}

