import type { ChangeEvent, FormEvent } from "react";
import {
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { InsertDriveFileOutlined, SendRounded, UploadFileOutlined } from "@mui/icons-material";
import type { StageState } from "../types";
import { UploadProgress } from "./UploadProgress";

type FormatOption = {
  value: string;
  label: string;
};

type UploadFormProps = {
  file: File | null;
  format: string;
  isSubmitting: boolean;
  uploadProgress: number | null;
  stages: StageState[];
  formatOptions: FormatOption[];
  onFileChange: (file: File | null) => void;
  onFormatChange: (format: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function UploadForm({
  file,
  format,
  isSubmitting,
  uploadProgress,
  stages,
  formatOptions,
  onFileChange,
  onFormatChange,
  onSubmit,
}: UploadFormProps) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFileChange(event.target.files?.[0] ?? null);
  };

  const handleFormatChange = (event: SelectChangeEvent) => {
    onFormatChange(event.target.value as string);
  };

  return (
    <Stack component="form" spacing={3} onSubmit={onSubmit}>
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        textAlign="center"
        gap={2}
        px={3}
        py={4}
        border="1px dashed"
        borderColor="divider"
        borderRadius={2}
        sx={{
          transition: (theme) => theme.transitions.create(["border-color", "box-shadow"]),
          "&:hover": {
            borderColor: "primary.main",
            boxShadow: (theme) => theme.shadows[1],
          },
        }}
      >
        <UploadFileOutlined color="primary" sx={{ fontSize: 42 }} />
        <Stack spacing={1} alignItems="center">
          <Typography variant="h6">בחרו קובץ וידאו או אודיו</Typography>
          <Typography variant="body2" color="text.secondary">
            ניתן לגרור קובץ לחלון או לבחור אותו מהמחשב שלכם
          </Typography>
        </Stack>
        <Button
          component="label"
          variant="outlined"
          size="large"
          startIcon={<InsertDriveFileOutlined />}
        >
          בחירת קובץ
          <input hidden type="file" accept="video/*,audio/*" onChange={handleFileChange} />
        </Button>
        {file ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip icon={<InsertDriveFileOutlined fontSize="small" />} label={file.name} variant="outlined" />
            <Typography variant="caption" color="text.secondary">
              {formatFileSize(file.size)}
            </Typography>
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            טרם נבחר קובץ
          </Typography>
        )}
      </Box>

      <FormControl fullWidth>
        <InputLabel id="subtitle-format-label">פורמט כתוביות</InputLabel>
        <Select
          labelId="subtitle-format-label"
          id="subtitle-format"
          value={format}
          label="פורמט כתוביות"
          onChange={handleFormatChange}
        >
          {formatOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {uploadProgress !== null && (
        <UploadProgress progress={uploadProgress} stages={stages} />
      )}

      <Button
        type="submit"
        variant="contained"
        size="large"
        endIcon={<SendRounded />}
        disabled={isSubmitting}
      >
        {isSubmitting ? "מעבד..." : "שלחו לעיבוד"}
      </Button>
    </Stack>
  );
}

function formatFileSize(size: number) {
  if (!size) {
    return "0B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}
