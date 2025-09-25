import type { ChangeEvent } from "react";
import { useEffect, useRef } from "react";
import { CircularProgress, Stack, TextField, Typography, Box } from "@mui/material";
import { AccessTimeRounded } from "@mui/icons-material";
import type { Segment } from "../types";
import { formatTime } from "../utils/formatTime";

type SaveState = "idle" | "saving" | "success" | "error";

type SubtitleEditorProps = {
  segments: Segment[];
  isEditable: boolean;
  saveState: SaveState;
  saveError: string | null;
  activeSegmentId?: Segment["id"] | null;
  onSegmentTextChange: (segmentId: Segment["id"], value: string) => void;
  onSegmentBlur: (segmentId: Segment["id"]) => Promise<void>;
};

export function SubtitleEditor({
  segments,
  isEditable,
  saveState,
  saveError,
  activeSegmentId,
  onSegmentTextChange,
  onSegmentBlur,
}: SubtitleEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeSegmentId && activeSegmentRef.current && containerRef.current) {
      activeSegmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeSegmentId]);
  if (segments.length === 0) {
    return (
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center">
          <AccessTimeRounded color="primary" />
          <Typography variant="h6">מקטעים מתוזמנים</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          לא נמצאו מקטעים להצגה.
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} ref={containerRef}>
      <Stack direction="row" spacing={1} alignItems="center">
        <AccessTimeRounded color="primary" />
        <Typography variant="h6">מקטעים מתוזמנים</Typography>
      </Stack>

      <Stack spacing={2} sx={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {segments.map((segment) => {
          const isActive = segment.id === activeSegmentId;
          return (
            <Box
              key={segment.id}
              ref={isActive ? activeSegmentRef : undefined}
              sx={{
                p: 2,
                borderRadius: 2,
                border: isActive ? 2 : 1,
                borderColor: isActive ? 'primary.main' : 'divider',
                bgcolor: isActive ? 'primary.50' : 'background.paper',
                transition: 'all 0.3s ease-in-out',
              }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <AccessTimeRounded
                    fontSize="small"
                    color={isActive ? "primary" : "action"}
                  />
                  <Typography
                    variant="body2"
                    fontWeight={isActive ? 700 : 600}
                    color={isActive ? "primary" : "text.primary"}
                  >
                    {`${formatTime(segment.start)} – ${formatTime(segment.end)}`}
                  </Typography>
                </Stack>
                <TextField
                  multiline
                  minRows={2}
                  value={segment.text}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    onSegmentTextChange(segment.id, event.target.value)
                  }
                  onBlur={() => onSegmentBlur(segment.id)}
                  fullWidth
                  disabled={!isEditable}
                  variant={isActive ? "outlined" : "standard"}
                />
              </Stack>
            </Box>
          );
        })}
      </Stack>

      {saveState === "saving" && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={20} />
          <Typography variant="body2">שומר שינויים...</Typography>
        </Stack>
      )}

      {saveState === "success" && (
        <Typography variant="body2" color="success.main">
          השינויים נשמרו.
        </Typography>
      )}

      {saveState === "error" && saveError && (
        <Typography variant="body2" color="error.main">
          {saveError}
        </Typography>
      )}
    </Stack>
  );
}