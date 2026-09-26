import { Box, Chip, LinearProgress, List, ListItem, ListItemIcon, ListItemText, Typography } from "@mui/material";
import {
  CheckCircleOutline,
  ErrorOutline,
  HourglassEmpty,
  PlayCircleOutline,
  SkipNext,
} from "@mui/icons-material";
import type { StageState } from "../types";
import { Alert } from "@mui/material";

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
  const uploading = progress < 100;
  const uploadConfirmed = stages.some(stage => stage.id === "upload" && stage.status === "done");
  return (
    <Box mt={{ xs: 0.5, sm: 2 }} display="flex" flexDirection="column" gap={{ xs: "clamp(4px, calc(3dvh - 12px), 12px)", sm: 2 }}>
      <Alert severity={uploadConfirmed ? "info" : "warning"} role={uploadConfirmed ? "status" : "alert"} sx={{ py: 0.5, px: 1, fontSize: { xs: "0.8125rem", sm: "0.875rem" }, "& .MuiAlert-message": { py: 0.5 } }}>
        {uploadConfirmed
          ? "הסרטון נקלט בשרת. העיבוד ממשיך גם כשהמסך נעול או כשעוברים לאפליקציה אחרת. חזרו לכאן לצפייה בתוצאה."
          : "עד לאישור קליטת הסרטון בשרת, השאירו את העמוד פתוח. אל תנעלו את המסך ואל תעברו לאפליקציה אחרת — ההעלאה עלולה להיעצר."}
      </Alert>
      {!uploading && !uploadConfirmed && <Typography variant="caption" color="text.secondary" role="status">ממתינים לאישור קליטת הסרטון בשרת...</Typography>}
      <Box display="flex" alignItems="center" gap={{ xs: 1, sm: 2 }}>
        <LinearProgress aria-label={uploading ? "התקדמות העלאה" : uploadConfirmed ? "עיבוד הסרטון" : "אישור קליטת הסרטון"} variant={uploading ? "determinate" : "indeterminate"} value={progress} sx={{ flexGrow: 1, height: 8, borderRadius: 999 }} />
        {uploading && <Typography variant="body2" color="text.secondary">
          {progress}%
        </Typography>}
      </Box>

      <List dense disablePadding>
        {stages.map((stage) => (
          <ListItem
            key={stage.id}
            sx={{
              borderRadius: 2,
              px: { xs: 0.5, sm: 1 },
              py: { xs: 0, sm: 0.5 },
              mb: { xs: 0, sm: 0.5 },
              minHeight: { xs: "clamp(24px, calc(5dvh - 4px), 40px)", sm: "auto" },
              columnGap: 1,
              bgcolor: stage.status === "active" ? "action.hover" : "transparent",
            }}
          >
            <ListItemIcon sx={{ minWidth: { xs: 28, sm: 36 }, "& svg": { fontSize: { xs: 20, sm: 24 } } }}>{STATUS_ICON[stage.status]}</ListItemIcon>
            <ListItemText
              primary={stage.label}
              secondary={stage.message ?? undefined}
              primaryTypographyProps={{ fontWeight: stage.status === "active" ? 600 : undefined, sx: { fontSize: { xs: "0.875rem", sm: "1rem" } } }}
              secondaryTypographyProps={{ sx: { display: { xs: "none", sm: "block" } } }}
              sx={{ my: { xs: 0, sm: 0.5 }, minWidth: 0, textAlign: "start" }}
            />
            <Chip label={STATUS_LABEL[stage.status]} size="small" color={chipColor(stage.status)} variant="outlined" sx={{ flexShrink: 0, height: { xs: 22, sm: 24 }, "& .MuiChip-label": { px: { xs: 0.75, sm: 1 } } }} />
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
