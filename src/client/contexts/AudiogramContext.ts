import { createContext } from "react";
import type { ProjectAudiogram } from "../hooks/useProjectAudiogram";

// Provided only while the loaded media is audio-only.
export const AudiogramContext = createContext<(ProjectAudiogram & { disabled: boolean }) | null>(null);
