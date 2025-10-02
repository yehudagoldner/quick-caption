import {
  Alert,
  List,
  ListItem,
  ListItemIcon,
  Stack,
  Typography,
} from "@mui/material";
import {
  FormatListBulletedRounded,
} from "@mui/icons-material";

type TranscriptionResultHeaderProps = {
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
  warnings: string[] | undefined;
  onBack: () => void;
};

export function TranscriptionResultHeader({
  warnings,
}: TranscriptionResultHeaderProps) {
  return (
    <Stack spacing={3}>
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