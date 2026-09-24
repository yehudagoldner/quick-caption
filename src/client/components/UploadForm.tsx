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
import { InitialCharacterLimitSlider } from "./InitialCharacterLimitSlider";
import { useEffect, useRef, useState } from "react";

type UploadFormProps = {
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
    <Stack component="form" dir="rtl" spacing={{ xs: file ? 1.25 : 2, sm: 3 }} onSubmit={onSubmit}>
      {isSubmitting ? (
        <Typography variant="body1" textAlign="center">{file ? file.name : "בודקים את מצב העיבוד בשרת..."}</Typography>
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
        py={{ xs: 3, sm: 4 }}
        border="1px dashed"
        borderColor="divider"
        borderRadius={2}
        sx={{
          bgcolor: dragging ? "action.hover" : "background.paper",
          borderColor: dragging ? "primary.main" : "divider",
          minWidth: 0,
          minHeight: { xs: "clamp(200px, 34dvh, 290px)", sm: undefined },
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
      </Box> : <Box display="flex" justifyContent="center">
        <Button component="label" variant="outlined" size="large" disabled={isSubmitting} sx={{ minHeight: { xs: 36, sm: 48 } }}>
          החלפת סרטון
          <input hidden type="file" accept="video/*,audio/*,.wav,.flac,.mp3,.m4a,.mp4,.mov,.mkv" disabled={isSubmitting} onChange={handleFileChange} />
        </Button>
      </Box>}

      {fileError && <Alert severity="error">{fileError}</Alert>}
      {previewUrl && !isSubmitting && <Stack spacing={{ xs: 0.25, sm: 1 }} alignItems="center">
        <Box component={file?.type.startsWith("audio/") || /\.(wav|flac|mp3|m4a|aac|ogg|opus)$/i.test(file?.name || "") ? "audio" : "video"}
          controls src={previewUrl} preload="metadata" onError={() => setFileError("הדפדפן לא מצליח לנגן את הקובץ. אפשר לנסות לתמלל אותו או לבחור פורמט אחר.")}
          onLoadedMetadata={(event: React.SyntheticEvent<HTMLMediaElement>) => {
            const media = event.currentTarget as HTMLVideoElement;
            const ratio = media.videoWidth && media.videoHeight ? ` · ${media.videoWidth}×${media.videoHeight} · ${media.videoHeight > media.videoWidth ? "אנכי" : "אופקי"}` : " · אודיו בלבד";
            setMediaInfo(`${Math.round(media.duration)} שניות${ratio}`);
          }} sx={{ maxWidth: "100%", maxHeight: { xs: "min(22dvh, 170px)", sm: 220 }, borderRadius: 2 }} />
        <Typography variant="caption" sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" } }}>{mediaInfo}</Typography>
      </Stack>}
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

      {isSubmitting && <Stack spacing={0.5} alignItems="center">
        <Button type="button" variant="outlined" onClick={onBackToUpload} sx={{ minHeight: 44 }}>
          חזרה לבחירת קובץ
        </Button>
        {isSubmitting && <Typography variant="caption" color="text.secondary" textAlign="center">
          עיבוד שכבר התחיל עשוי להמשיך ולהופיע ב״הסרטונים שלי״.
        </Typography>}
      </Stack>}

      {file && !isSubmitting && <Box sx={{ display: { xs: "block", sm: "none" } }}>
        <InitialCharacterLimitSlider value={maxCharactersPerSubtitle} onChange={onMaxCharactersChange} />
      </Box>}
    </Stack>
  );
}
