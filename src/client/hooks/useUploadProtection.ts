import { useEffect } from "react";

// Wake locks only prevent automatic screen sleep while the page is visible.
// The upload warning must remain even if the browser grants the lock.
export function useUploadProtection(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let requesting = false;
    let lock: WakeLockSentinel | null = null;
    const release = (sentinel: WakeLockSentinel) => { void sentinel.release().catch(() => {}); };
    const request = async () => {
      if (disposed || requesting || document.visibilityState !== "visible" || (lock && !lock.released) || !navigator.wakeLock) return;
      requesting = true;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (disposed || document.visibilityState !== "visible") { release(sentinel); return; }
        lock = sentinel;
        sentinel.addEventListener("release", () => { if (lock === sentinel) lock = null; }, { once: true });
      } catch { /* Unsupported, power saving, or denied: the visible warning still applies. */ }
      finally { requesting = false; }
    };
    const visibilityChange = () => {
      if (document.visibilityState === "visible") void request();
      else if (lock) { const sentinel = lock; lock = null; release(sentinel); }
    };
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", visibilityChange);
    window.addEventListener("pageshow", request);
    window.addEventListener("beforeunload", warnBeforeLeaving);
    void request();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibilityChange);
      window.removeEventListener("pageshow", request);
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      if (lock) release(lock);
    };
  }, [active]);
}
