import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export type TextDirection = "rtl" | "ltr";
type Preferences = { fps: number; direction: TextDirection; maxCharacters: number; limitCharacters: boolean };
const defaults: Preferences = { fps: 24, direction: "rtl", maxCharacters: 20, limitCharacters: true };
export const FRAME_RATES = [24, 25, 30, 50, 60, 120];
const Context = createContext<{ preferences: Preferences; update: (value: Partial<Preferences>) => void } | null>(null);
export function EditorPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("caption-editor-preferences") || "null");
      return {
        fps: FRAME_RATES.includes(saved?.fps) ? saved.fps : 24,
        direction: saved?.direction === "ltr" ? "ltr" : "rtl",
        maxCharacters: Number.isInteger(saved?.maxCharacters) && saved.maxCharacters >= 7 && saved.maxCharacters <= 20 ? saved.maxCharacters : 20,
        limitCharacters: typeof saved?.limitCharacters === "boolean" ? saved.limitCharacters : true,
      };
    } catch { return defaults; }
  });
  const update = (value: Partial<Preferences>) => setPreferences(previous => {
    const next = { ...previous, ...value };
    try { localStorage.setItem("caption-editor-preferences", JSON.stringify(next)); } catch { /* Storage is optional. */ }
    return next;
  });
  return <Context.Provider value={{ preferences, update }}>{children}</Context.Provider>;
}
export function useEditorPreferences() {
  const context = useContext(Context);
  if (!context) throw new Error("Missing EditorPreferencesProvider");
  return context;
}
