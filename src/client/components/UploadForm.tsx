import type { ChangeEvent, FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  Typography,
} from "@mui/material";
import { InsertDriveFileOutlined, SendRounded, UploadFileOutlined } from "@mui/icons-material";
import type { StageState } from "../types";
import { UploadProgress } from "./UploadProgress";
import { InitialTranscriptionSettings, type InitialTranscriptionSettingsProps } from "./InitialTranscriptionSettings";
import { useEffect, useRef, useState } from "react";
import { MAX_MEDIA_BYTES, MEDIA_SIZE_ERROR } from "../../mediaPolicy.js";

type UploadFormProps = InitialTranscriptionSettingsProps & {
  file: File | null;
  isSubmitting: boolean;
  uploadProgress: number | null;
  stages: StageState[];
  maxCharactersPerSubtitle: number;
  onFileChange: (file: File | null) => void;
  onMaxCharactersChange: (value: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBackToUpload: () => void;
};

export function UploadForm({
  file,
  isSubmitting,
  uploadProgress,
  stages,
  maxCharactersPerSubtitle,
  onFileChange,
  onMaxCharactersChange,
  onSubmit,
  onBackToUpload,
  ...settings
}: UploadFormProps) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mediaInfo, setMediaInfo] = useState("");
  useEffect(() => {
    setMediaInfo("");
    setFileError(null);
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const chooseFile = (next: File | undefined) => {
    if (!next || isSubmitting) return;
    if (next.size > MAX_MEDIA_BYTES) { setFileError(MEDIA_SIZE_ERROR); return; }
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
    <Stack component="form" dir="rtl" spacing={1} onSubmit={onSubmit}>
      {isSubmitting ? (
        <Typography variant="body1" textAlign="center" sx={{ overflowWrap: "anywhere" }}>{file ? file.name : "בודקים את מצב העיבוד בשרת..."}</Typography>
      ) : !file ? <Box
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
        gap={{ xs: 1.5, sm: 2 }}
        px={{ xs: 1.5, sm: 3 }}
        py={2}
        border="1px dashed"
        borderColor="divider"
        borderRadius={2}
        sx={{
          bgcolor: dragging ? "action.hover" : "background.paper",
          borderColor: dragging ? "primary.main" : "divider",
          minWidth: 0,
          minHeight: "clamp(170px, 30dvh, 250px)",
          transition: (theme) => theme.transitions.create(["border-color", "box-shadow"]),
          "&:hover": {
            borderColor: "primary.main",
            boxShadow: (theme) => theme.shadows[1],
          },
        }}
      >
        <UploadFileOutlined color="primary" sx={{ fontSize: { xs: 38, sm: 42 } }} />
        <Stack spacing={{ xs: 0, sm: 1 }} alignItems="center">
          <Typography variant="h6" sx={{ fontSize: { xs: "1.125rem", sm: "1.25rem" } }}>בחרו קובץ וידאו או אודיו</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
            ניתן לגרור קובץ לחלון או לבחור אותו מהמחשב שלכם
          </Typography>
        </Stack>
        <Button
          component="label"
          variant="outlined"
          size="large"
          sx={{ minHeight: 48 }}
          startIcon={<InsertDriveFileOutlined />}
          disabled={isSubmitting}
        >
          בחירת קובץ
          <input hidden type="file" accept="video/*,audio/*,.wav,.flac,.mp3,.m4a,.mp4,.mov,.mkv" disabled={isSubmitting} onChange={handleFileChange} />
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
          טרם נבחר קובץ
        </Typography>
      </Box> : <Box display="flex" alignItems="center" gap={1}>
        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }} title={file.name}>{file.name}</Typography>
        <Button component="label" variant="outlined" size="small" disabled={isSubmitting} sx={{ minHeight: 32, flexShrink: 0 }}>
          החלפת קובץ
          <input hidden type="file" accept="video/*,audio/*,.wav,.flac,.mp3,.m4a,.mp4,.mov,.mkv" disabled={isSubmitting} onChange={handleFileChange} />
        </Button>
      </Box>}

      {fileError && <Alert severity="error">{fileError}</Alert>}
      {file && !isSubmitting && <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) minmax(0, 1.2fr)" }, alignItems: "center", gap: 1.5 }}>
      {previewUrl && <Stack spacing={0.25} alignItems="center" sx={{ minWidth: 0 }}>
        <Box component={file?.type.startsWith("audio/") || /\.(wav|flac|mp3|m4a|aac|ogg|opus)$/i.test(file?.name || "") ? "audio" : "video"}
          controls src={previewUrl} preload="metadata" onError={() => setFileError("הדפדפן לא מצליח לנגן את הקובץ. אפשר לנסות לתמלל אותו או לבחור פורמט אחר.")}
          onLoadedMetadata={(event: React.SyntheticEvent<HTMLMediaElement>) => {
            const media = event.currentTarget as HTMLVideoElement;
            const ratio = media.videoWidth && media.videoHeight ? ` · ${media.videoWidth}×${media.videoHeight} · ${media.videoHeight > media.videoWidth ? "אנכי" : "אופקי"}` : " · אודיו בלבד";
            setMediaInfo(`${Math.round(media.duration)} שניות${ratio}`);
          }} sx={{ width: "100%", objectFit: "contain", maxHeight: { xs: "clamp(64px, calc(100dvh - 510px), 240px)", sm: "clamp(100px, calc(100dvh - 300px), 260px)" }, borderRadius: 2, bgcolor: "grey.900" }} />
        <Typography variant="caption" sx={{ fontSize: "0.75rem", "@media (max-height: 650px)": { display: "none" } }}>{mediaInfo}</Typography>
      </Stack>}
      <InitialTranscriptionSettings {...settings} maxCharactersPerSubtitle={maxCharactersPerSubtitle} onMaxCharactersChange={onMaxCharactersChange} />
      </Box>}
      {!isSubmitting && <Typography variant="caption" color="text.secondary" textAlign="center" sx={{ fontSize: "0.6875rem", lineHeight: 1.4 }}>עד 500MB לקובץ. סרטונים והכתוביות שלהם נמחקים לאחר 30 יום ללא פתיחה או עריכה.</Typography>}
      {!file && !isSubmitting && <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ display: { xs: "none", sm: "block" } }}>
        אחרי התמלול תוכלו לשנות את חלוקת הכתוביות, כיוון הטקסט, FPS ופורמט ההורדה — ללא תמלול נוסף.
      </Typography>}
      {uploadProgress !== null && (
        <UploadProgress progress={uploadProgress} stages={stages} />
      )}

      {(file || isSubmitting) && <Button
        type="submit"
        variant="contained"
        size="large"
        endIcon={<SendRounded />}
        disabled={isSubmitting || !file}
      >
        {isSubmitting ? "מעבד..." : "שלחו לעיבוד"}
      </Button>}

      {isSubmitting && <Stack spacing={{ xs: "clamp(4px, calc(3dvh - 12px), 12px)", sm: 0.5 }} alignItems="center">
        <Button type="button" variant="outlined" onClick={onBackToUpload} sx={{ minHeight: 44 }}>
          חזרה לבחירת קובץ
        </Button>
        {isSubmitting && <Typography variant="caption" color="text.secondary" textAlign="center">
          עיבוד שכבר התחיל עשוי להמשיך ולהופיע ב״הסרטונים שלי״.
        </Typography>}
      </Stack>}

    </Stack>
  );
}
