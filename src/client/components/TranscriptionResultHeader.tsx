import {
  Alert,
  Button,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  Stack,
  Typography,
} from "@mui/material";
import {
  DownloadRounded,
  FormatListBulletedRounded,
  ReplayRounded,
  SubtitlesRounded,
} from "@mui/icons-material";
import type { ApiResponse } from "../types";

type TranscriptionResultHeaderProps = {
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
  warnings: string[] | undefined;
  onBack: () => void;
};

export function TranscriptionResultHeader({
  subtitleFormatLabel,
  downloadUrl,
  downloadName,
  warnings,
  onBack,
}: TranscriptionResultHeaderProps) {
  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems="center" gap={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip label={subtitleFormatLabel} color="primary" variant="outlined" />
          {downloadUrl && (
            <Button
              component="a"
              href={downloadUrl}
              download={downloadName}
              variant="contained"
              startIcon={<DownloadRounded />}
            >
              הורידו את קובץ הכתוביות
            </Button>
          )}
        </Stack>
      </Stack>

      {warnings?.length ? (
        <Alert severity="warning" icon={<FormatListBulletedRounded />}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">אזהרות אפשריות:</Typography>
            <List dense disablePadding>
              {warnings.map((warning, index) => (
                <ListItem key={index} disableGutters sx={{ py: 0 }}>
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <FormatListBulletedRounded fontSize="small" />
                  </ListItemIcon>
                  <Typography variant="body2">{warning}</Typography>
                </ListItem>
              ))}
            </List>
          </Stack>
        </Alert>
      ) : null}
    </Stack>
  );
}