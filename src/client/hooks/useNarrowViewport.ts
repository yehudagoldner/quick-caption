import { useMediaQuery } from "@mui/material";

export const NARROW_VIEWPORT_MAX_PX = 499;

export function useNarrowViewport() {
  return useMediaQuery(`(max-width:${NARROW_VIEWPORT_MAX_PX}px)`, { noSsr: true });
}
