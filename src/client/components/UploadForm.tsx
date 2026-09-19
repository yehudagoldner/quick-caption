import type { ChangeEvent, FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { InsertDriveFileOutlined, SendRounded, UploadFileOutlined } from "@mui/icons-material";
import type { StageState } from "../types";
import { UploadProgress } from "./UploadProgress";
import { useEffect, useRef, useState } from "react";

type UploadFormProps = {
  file: File | null;
  isSubmitting: boolean;
  uploadProgress: number | null;
  stages: StageState[];
  onFileChange: (file: File | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function UploadForm({
  file,
  isSubmitting,
  uploadProgress,
  stages,
  onFileChange,
  onSubmit,
}: UploadFormProps) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mediaInfo, setMediaInfo] = useState("");
  useEffect(() => {
    setMediaInfo("");
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const chooseFile = (next: File | undefined) => {
    if (!next || isSubmitting) return;
    if (!/^(audio|video)\//.test(next.type) && !/\.(mp4|mov|webm|mkv|avi|m4v|wav|flac|mp3|m4a|aac|ogg|opus)$/i.test(next.name)) {
      setFileError("בחרו קובץ וידאו או אודיו נתמך."); return;
    }
    setFileError(null); onFileChange(next);
  };
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0]);
    event.target.value = "";
  };

  return (
    <Stack component="form" spacing={3} onSubmit={onSubmit}>
      <Box
        data-testid="media-dropzone"
        onDragEnter={e => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = isSubmitting ? "none" : "copy"; }}
        onDragLeave={e => { e.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
        onDrop={e => {
          e.preventDefault(); dragDepth.current = 0; setDragging(false);
          if (e.dataTransfer.files.length !== 1) { setFileError("אפשר להעלות קובץ אחד בכל פעם."); return; }
          chooseFile(e.dataTransfer.files[0]);
        }}
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
          bgcolor: dragging ? "action.hover" : "background.paper",
          borderColor: dragging ? "primary.main" : "divider",
          minWidth: 0,
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
          disabled={isSubmitting}
        >
          בחירת קובץ
          <input hidden type="file" accept="video/*,audio/*,.wav,.flac,.mp3,.m4a,.mp4,.mov,.mkv" disabled={isSubmitting} onChange={handleFileChange} />
        </Button>
        {file ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ maxWidth: "100%", minWidth: 0 }}>
            <Chip sx={{ minWidth: 0, maxWidth: "100%" }} icon={<InsertDriveFileOutlined fontSize="small" />} label={file.name} variant="outlined" />
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

      {fileError && <Alert severity="error">{fileError}</Alert>}
      {previewUrl && <Stack spacing={1} alignItems="center">
        <Box component={file?.type.startsWith("audio/") || /\.(wav|flac|mp3|m4a|aac|ogg|opus)$/i.test(file?.name || "") ? "audio" : "video"}
          controls src={previewUrl} preload="metadata" onError={() => setFileError("הדפדפן לא מצליח לנגן את הקובץ. אפשר לנסות לתמלל אותו או לבחור פורמט אחר.")}
          onLoadedMetadata={(event: React.SyntheticEvent<HTMLMediaElement>) => {
            const media = event.currentTarget as HTMLVideoElement;
            const ratio = media.videoWidth && media.videoHeight ? ` · ${media.videoWidth}×${media.videoHeight} · ${media.videoHeight > media.videoWidth ? "אנכי" : "אופקי"}` : " · אודיו בלבד";
            setMediaInfo(`${Math.round(media.duration)} שניות${ratio}`);
          }} sx={{ maxWidth: "100%", maxHeight: 220, borderRadius: 2 }} />
        <Typography variant="caption">{mediaInfo}</Typography>
      </Stack>}
      <Typography variant="body2" color="text.secondary" textAlign="center">
        אחרי התמלול תוכלו לשנות את חלוקת הכתוביות, כיוון הטקסט, FPS ופורמט ההורדה — ללא תמלול נוסף.
      </Typography>
      {uploadProgress !== null && (
        <UploadProgress progress={uploadProgress} stages={stages} />
      )}

      <Button
        type="submit"
        variant="contained"
        size="large"
        endIcon={<SendRounded />}
        disabled={isSubmitting || !file}
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
