import { createContext } from "react";

export type EditorNavigationGuard = (destination: () => void) => Promise<void>;

export const EditorNavigationContext = createContext<
  (guard: EditorNavigationGuard | null, blocked?: boolean) => void
>(() => {});
