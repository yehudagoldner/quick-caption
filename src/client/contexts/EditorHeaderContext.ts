import { createContext, useContext, useEffect, useRef } from "react";

export type EditorHeaderActions = {
  showShare: boolean;
  canShare: boolean;
  sharing: boolean;
  backDisabled: boolean;
  onShare: () => void;
  onMyVideos: () => void;
};

export const EditorHeaderContext = createContext<(actions: EditorHeaderActions | null) => void>(() => {});

export function useEditorHeaderActions(enabled: boolean, actions: EditorHeaderActions) {
  const register = useContext(EditorHeaderContext);
  const latest = useRef(actions);
  latest.current = actions;
  const { showShare, canShare, sharing, backDisabled } = actions;
  useEffect(() => {
    if (!enabled) return;
    register({ showShare, canShare, sharing, backDisabled,
      onShare: () => latest.current.onShare(),
      onMyVideos: () => latest.current.onMyVideos(),
    });
    return () => register(null);
  }, [enabled, register, showShare, canShare, sharing, backDisabled]);
}
