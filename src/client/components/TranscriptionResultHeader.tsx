import {
  Alert,
  Button,
  List,
  ListItem,
  ListItemIcon,
  Stack,
  Typography,
} from "@mui/material";
import {
  FormatListBulletedRounded,
  UploadFileOutlined,
} from "@mui/icons-material";

type TranscriptionResultHeaderProps = {
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
  warnings: string[] | undefined;
  onBack: () => void;
  backDisabled?: boolean;
};

export function TranscriptionResultHeader({
  warnings,
  onBack,
  backDisabled = false,
}: TranscriptionResultHeaderProps) {
  return (
    <Stack spacing={3}>
      <Button variant="outlined" startIcon={<UploadFileOutlined />} onClick={onBack} disabled={backDisabled} sx={{ alignSelf: "flex-start" }}>
        העלאת סרטון או אודיו אחר
      </Button>
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
