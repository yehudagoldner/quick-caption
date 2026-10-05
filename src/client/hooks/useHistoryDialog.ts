import { useCallback, useEffect, useId, useRef, useState } from "react";

// Give Back a same-page entry to consume before the app's screen navigation.
// Preserve editorIndex so opening a dialog is not treated as leaving an editor.
export function useHistoryDialog() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const closing = useRef(false);

  useEffect(() => {
    const handlePopState = () => {
      closing.current = false;
      setOpen(window.history.state?.quickcaptionDialog === id);
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (window.history.state?.quickcaptionDialog === id) {
        const { quickcaptionDialog: _, ...state } = window.history.state;
        window.history.replaceState(state, "", window.location.href);
      }
    };
  }, [id]);

  const show = useCallback(() => {
    if (closing.current) return;
    if (window.history.state?.quickcaptionDialog !== id) {
      window.history.pushState({ ...window.history.state, quickcaptionDialog: id }, "", window.location.href);
    }
    setOpen(true);
  }, [id]);

  const close = useCallback(() => {
    if (closing.current) return;
    if (window.history.state?.quickcaptionDialog === id) {
      closing.current = true;
      window.history.back();
    } else setOpen(false);
  }, [id]);

  return { open, show, close };
}
