import { useEffect, useState } from "react";
import { Container, Alert, CircularProgress, Box, Typography } from "@mui/material";
import { PreviewStepSection } from "./PreviewStepSection";
import type { AuthUser } from "../hooks/useTranscriptionWorkflow";
import type { ApiResponse, Segment } from "../types";
import type { BurnOptions } from "./TranscriptionResult";

interface VideoEditPageProps {
  user: AuthUser;
  videoToken: string; // Secure token instead of plain ID
  onSaveSegments: (segments: Segment[], subtitleContent: string) => Promise<void>;
}

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
const API_BASE_URL = RAW_API_BASE.replace(/\/?$/, "");

export function VideoEditPage({ user, videoToken, onSaveSegments }: VideoEditPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [format, setFormat] = useState<string>(".srt");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<number | null>(null);

  useEffect(() => {
    loadVideo();
  }, [videoToken, user]);

  const loadVideo = async () => {
    if (!user?.uid || !videoToken) {
      setError("נדרשת התחברות לצפייה בסרטון");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Use secure token-based loading instead of direct ID
      const url = `${API_BASE_URL || ""}/api/videos/load?token=${encodeURIComponent(videoToken)}&userUid=${encodeURIComponent(user.uid)}`;
      const fetchResponse = await fetch(url);

      if (!fetchResponse.ok) {
        if (fetchResponse.status === 404) {
          throw new Error("הסרטון לא נמצא או שאין לכם הרשאה לצפות בו");
        } else if (fetchResponse.status === 403) {
          throw new Error("אין לכם הרשאה לצפות בסרטון זה");
        } else {
          throw new Error("שגיאה בטעינת הסרטון");
        }
      }

      const data = await fetchResponse.json();
      const video = data.video;

      if (!video || !video.subtitle_json) {
        throw new Error("הסרטון לא מכיל כתוביות לעריכה");
      }

      const segments = typeof video.subtitle_json === "string"
        ? JSON.parse(video.subtitle_json)
        : video.subtitle_json;

      const subtitleContent = segmentsToSrt(segments);
      const videoFormat = video.format || ".srt";

      setVideoId(video.id);
      setFormat(videoFormat);
      setResponse({
        text: segments.map((s: Segment) => s.text).join("\n"),
        segments,
        subtitle: {
          format: videoFormat,
          content: subtitleContent,
        },
        videoId: video.id,
      });

      // Set media URL if video file exists
      if (video.stored_path) {
        const mediaUrl = `${API_BASE_URL || ""}/api/videos/${video.id}/media?userUid=${encodeURIComponent(user.uid)}`;
        setMediaUrl(mediaUrl);
      }

    } catch (err) {
      console.error("Failed to load video:", err);
      setError(err instanceof Error ? err.message : "שגיאה בטעינת הסרטון");
    } finally {
      setLoading(false);
    }
  };

  const handleBurnVideoRequest = async (options: BurnOptions) => {
    if (!response?.subtitle?.content) {
      throw new Error("אין כתוביות לשריפה");
    }

    // For editing mode, we need to fetch the original video file
    if (!videoId || !user?.uid) {
      throw new Error("שגיאה בטעינת הסרטון לשריפה");
    }

    const videoResponse = await fetch(`${API_BASE_URL || ""}/api/videos/${videoId}/file?userUid=${encodeURIComponent(user.uid)}`);
    if (!videoResponse.ok) {
      throw new Error("לא ניתן לטעון את הסרטון לשריפה");
    }

    const videoBlob = await videoResponse.blob();

    const formData = new FormData();
    formData.append("media", videoBlob, "video");
    formData.append("subtitleContent", response.subtitle.content);
    formData.append("fontSize", String(options.fontSize));
    formData.append("fontColor", options.fontColor);
    formData.append("outlineColor", options.outlineColor);
    formData.append("offsetYPercent", String(options.offsetYPercent));
    formData.append("marginPercent", String(options.marginPercent));

    if (typeof options.videoWidth === "number" && options.videoWidth > 0) {
      formData.append("videoWidth", String(Math.round(options.videoWidth)));
    }
    if (typeof options.videoHeight === "number" && options.videoHeight > 0) {
      formData.append("videoHeight", String(Math.round(options.videoHeight)));
    }

    const burnResponse = await fetch(`${API_BASE_URL || ""}/api/burn-subtitles`, {
      method: "POST",
      body: formData,
    });

    if (!burnResponse.ok) {
      throw new Error("שגיאה בשריפת הכתוביות");
    }

    const blob = await burnResponse.blob();
    const filename = parseContentDispositionFilename(burnResponse.headers.get("Content-Disposition"));
    return { blob, filename };
  };

  const handleSaveSegments = async (segments: Segment[], subtitleContent: string) => {
    setResponse(prev =>
      prev ? {
        ...prev,
        segments,
        subtitle: prev.subtitle ? { ...prev.subtitle, content: subtitleContent } : prev.subtitle,
        text: segments.map(segment => segment.text).join("\n"),
      } : prev
    );

    await onSaveSegments(segments, subtitleContent);
  };

  if (loading) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ py: 4 }}>
          <Alert severity="error">{error}</Alert>
        </Box>
      </Container>
    );
  }

  if (!response) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ py: 4 }}>
          <Alert severity="warning">לא נמצאו כתוביות לעריכה</Alert>
        </Box>
      </Container>
    );
  }

  const formatLabel = (() => {
    const supportedFormats = [
      { value: ".srt", label: "SRT (SubRip)" },
      { value: ".vtt", label: "VTT (WebVTT)" },
      { value: ".txt", label: "Text" },
    ];
    return supportedFormats.find(option => option.value === format)?.label ?? format;
  })();

  const downloadUrl = response.subtitle?.content ?
    URL.createObjectURL(new Blob([response.subtitle.content], { type: "text/plain;charset=utf-8" })) :
    null;

  const downloadName = `subtitle${format}`;

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, textAlign: "center" }}>
          עריכת כתוביות
        </Typography>

        <PreviewStepSection
          active={true}
          response={response}
          subtitleFormatLabel={formatLabel}
          downloadUrl={downloadUrl}
          downloadName={downloadName}
          mediaUrl={mediaUrl}
          onBack={() => {}}
          onBurn={handleBurnVideoRequest}
          onSaveSegments={handleSaveSegments}
          videoId={videoId}
          isEditable={true}
        />
      </Box>
    </Container>
  );
}

function segmentsToSrt(segments: Segment[]) {
  return segments
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}\n${segment.text}\n`,
    )
    .join("\n");
}

function formatSrtTimestamp(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return "00:00:00,000";
  }
  const totalMillis = Math.max(0, Math.round(seconds * 1000));
  const hrs = Math.floor(totalMillis / 3_600_000);
  const mins = Math.floor((totalMillis % 3_600_000) / 60_000);
  const secs = Math.floor((totalMillis % 60_000) / 1000);
  const millis = totalMillis % 1000;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function parseContentDispositionFilename(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const utfMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch (error) {
      console.warn("Failed to decode filename from header:", error);
    }
  }
  const quotedMatch = value.match(/filename="?([^";]+)"?/i);
  return quotedMatch?.[1] ?? undefined;
}