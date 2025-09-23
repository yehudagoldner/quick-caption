import { Box, Chip, LinearProgress, List, ListItem, ListItemIcon, ListItemText, Typography } from "@mui/material";
import {
  CheckCircleOutline,
  ErrorOutline,
  HourglassEmpty,
  PlayCircleOutline,
  SkipNext,
} from "@mui/icons-material";
import type { StageState } from "../types";

type UploadProgressProps = {
  progress: number;
  stages: StageState[];
};

const STATUS_ICON: Record<StageState["status"], JSX.Element> = {
  idle: <HourglassEmpty color="disabled" />,
  active: <PlayCircleOutline color="info" />,
  done: <CheckCircleOutline color="success" />,
  skipped: <SkipNext color="warning" />,
  error: <ErrorOutline color="error" />,
};

const STATUS_LABEL: Record<StageState["status"], string> = {
  idle: "בהמתנה",
  active: "בתהליך",
  done: "הושלם",
  skipped: "דולג",
  error: "שגיאה",
};

export function UploadProgress({ progress, stages }: UploadProgressProps) {
  return (
    <Box mt={2} display="flex" flexDirection="column" gap={2}>
      <Box display="flex" alignItems="center" gap={2}>
        <LinearProgress variant="determinate" value={progress} sx={{ flexGrow: 1, height: 8, borderRadius: 999 }} />
        <Typography variant="body2" color="text.secondary">
          {progress}%
        </Typography>
      </Box>

      <List dense disablePadding>
        {stages.map((stage) => (
          <ListItem
            key={stage.id}
            sx={{
              borderRadius: 2,
              px: 1,
              py: 0.5,
              mb: 0.5,
              bgcolor: stage.status === "active" ? "action.hover" : "transparent",
            }}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>{STATUS_ICON[stage.status]}</ListItemIcon>
            <ListItemText
              primary={stage.label}
              secondary={stage.message ?? undefined}
              primaryTypographyProps={{ fontWeight: stage.status === "active" ? 600 : undefined }}
            />
            <Chip label={STATUS_LABEL[stage.status]} size="small" color={chipColor(stage.status)} variant="outlined" />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

function chipColor(status: StageState["status"]) {
  switch (status) {
    case "done":
      return "success";
    case "active":
      return "info";
    case "error":
      return "error";
    case "skipped":
      return "warning";
    default:
      return "default";
  }
}
