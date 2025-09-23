import {
  Alert,
  Button,
  Card,
  CardContent,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  AccessTimeRounded,
  DescriptionOutlined,
  DownloadRounded,
  FormatListBulletedRounded,
  SubtitlesRounded,
} from "@mui/icons-material";
import type { ApiResponse } from "../types";
import { formatTime } from "../utils/formatTime";

type TranscriptionResultProps = {
  response: ApiResponse;
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
};

export function TranscriptionResult({
  response,
  subtitleFormatLabel,
  downloadUrl,
  downloadName,
}: TranscriptionResultProps) {
  return (
    <Card elevation={2}>
      <CardContent>
        <Stack spacing={3}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <SubtitlesRounded color="primary" />
            <Typography variant="h5">שלב 2 – תוצאות</Typography>
          </Stack>

          {response.warnings?.length ? (
            <Alert severity="warning" icon={<FormatListBulletedRounded />}>
              <Stack spacing={1}>
                <Typography variant="subtitle2">אזהרות אפשריות:</Typography>
                <List dense disablePadding>
                  {response.warnings.map((warning, index) => (
                    <ListItem key={index} disableGutters sx={{ py: 0 }}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <FormatListBulletedRounded fontSize="small" />
                      </ListItemIcon>
                      <ListItemText primaryTypographyProps={{ variant: "body2" }} primary={warning} />
                    </ListItem>
                  ))}
                </List>
              </Stack>
            </Alert>
          ) : null}

          <Stack direction={{ xs: "column", md: "row" }} spacing={3} alignItems="stretch">
            <Stack spacing={2} flex={1}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Stack direction="row" spacing={1} alignItems="center">
                  <DescriptionOutlined color="primary" />
                  <Typography variant="h6">כתוביות ({subtitleFormatLabel})</Typography>
                </Stack>
                {downloadUrl && (
                  <Button
                    component="a"
                    href={downloadUrl}
                    download={downloadName}
                    variant="contained"
                    startIcon={<DownloadRounded />}
                  >
                    הורידו קובץ
                  </Button>
                )}
              </Stack>
              <TextField
                value={response.subtitle?.content ?? ""}
                multiline
                minRows={10}
                InputProps={{ readOnly: true }}
                fullWidth
              />
            </Stack>

            <Divider orientation="vertical" flexItem sx={{ display: { xs: "none", md: "block" } }} />

            <Stack spacing={2} flex={1}>
              <Stack direction="row" spacing={1} alignItems="center">
                <DescriptionOutlined color="primary" />
                <Typography variant="h6">תמלול גולמי</Typography>
              </Stack>
              <TextField
                value={response.text ?? ""}
                multiline
                minRows={10}
                InputProps={{ readOnly: true }}
                fullWidth
              />
            </Stack>
          </Stack>

          <Divider />

          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <AccessTimeRounded color="primary" />
              <Typography variant="h6">מקטעים</Typography>
            </Stack>
            {response.segments?.length ? (
              <List disablePadding sx={{ borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                {response.segments.map((segment, index) => (
                  <ListItem
                    key={segment.id}
                    divider={index < response.segments.length - 1}
                    sx={{ alignItems: "flex-start" }}
                  >
                    <ListItemIcon sx={{ minWidth: 48, mt: 0.5 }}>
                      <AccessTimeRounded fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={`${formatTime(segment.start)} – ${formatTime(segment.end)}`}
                      secondary={segment.text}
                      secondaryTypographyProps={{ component: "span" }}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Alert severity="info">לא נמצאו מקטעים להצגה.</Alert>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
