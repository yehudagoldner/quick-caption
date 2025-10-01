import { useEffect, useRef, useState } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { VideoLibraryRounded } from "@mui/icons-material";
import type { Word } from "../types";
import { useActiveWord } from "../hooks/useActiveWord";

type VideoPlayerProps = {
  mediaUrl: string | null;
  activeSegmentText: string | null;
  previewStyle: React.CSSProperties;
  words?: Word[];
  currentTime: number;
  activeWordEnabled: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (dimensions: { width: number; height: number }, duration: number) => void;
  onResize?: (dimensions: { width: number; height: number }) => void;
};

export function VideoPlayer({
  mediaUrl,
  activeSegmentText,
  previewStyle,
  words,
  currentTime,
  activeWordEnabled,
  onTimeUpdate,
  onLoadedMetadata,
  onResize,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const activeWord = useActiveWord({
    words,
    currentTime,
    enabled: activeWordEnabled,
  });

  // Debug logging for active segment text changes
  useEffect(() => {
    console.debug('📺 VideoPlayer activeSegmentText changed:', {
      activeSegmentText,
      hasText: !!activeSegmentText,
      textLength: activeSegmentText?.length || 0
    });
  }, [activeSegmentText]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const nextTime = video.currentTime;
      onTimeUpdate?.(nextTime);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [onTimeUpdate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      onLoadedMetadata?.({ width: 0, height: 0 }, 0);
      onResize?.({ width: 0, height: 0 });
      return;
    }

    const updateIntrinsic = () => {
      if (video.videoWidth && video.videoHeight) {
        onLoadedMetadata?.({ width: video.videoWidth, height: video.videoHeight }, video.duration || 0);
      }
    };

    const updateRendered = () => {
      const rect = video.getBoundingClientRect();
      if (rect.width && rect.height) {
        onResize?.({ width: rect.width, height: rect.height });
      }
    };

    updateIntrinsic();
    updateRendered();

    video.addEventListener("loadedmetadata", updateIntrinsic);

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateRendered);
      observer.observe(video);

      return () => {
        video.removeEventListener("loadedmetadata", updateIntrinsic);
        observer.disconnect();
      };
    }

    window.addEventListener("resize", updateRendered);
    return () => {
      video.removeEventListener("loadedmetadata", updateIntrinsic);
      window.removeEventListener("resize", updateRendered);
    };
  }, [mediaUrl, onLoadedMetadata, onResize]);

  // Expose video ref for external control
  useEffect(() => {
    if (videoRef.current) {
      (window as any).__videoPlayerRef = videoRef.current;
    }
  }, [mediaUrl]); // Re-run when mediaUrl changes to ensure new video elements are captured

  return (
    <Stack spacing={2}>     
      <Box
        position="relative"
        borderRadius={3}
        overflow="hidden"
        bgcolor="common.black"
        boxShadow={(theme) => theme.shadows[4]}
        minHeight={280}
      >
        {mediaUrl ? (
          <>
            <Box
              component="video"
              ref={videoRef}
              controls
              src={mediaUrl}
              sx={{ width: "100%", display: "block", backgroundColor: "common.black" }}
            />
            {activeSegmentText && (
              <Box sx={previewStyle}>
                {activeWordEnabled && activeWord ? (
                  // Render text with active word highlighted
                  renderTextWithActiveWord(activeSegmentText, activeWord.word)
                ) : (
                  // Render plain text
                  activeSegmentText
                )}
              </Box>
            )}
          </>
        ) : (
          <Stack height="100%" alignItems="center" justifyContent="center" spacing={1}>
            <Typography variant="body1">אין תצוגה זמינה לקובץ הנוכחי.</Typography>
            <Typography variant="body2" color="text.secondary">
              בדקו שהקובץ נטען בהצלחה ונסו שוב.
            </Typography>
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

export function useVideoPlayer() {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    // Function to check and update video element
    const updateVideoElement = () => {
      const element = (window as any).__videoPlayerRef as HTMLVideoElement | null;
      setVideoElement(element);
    };

    // Initial check
    updateVideoElement();

    // Set up polling to catch when video element changes
    const interval = setInterval(updateVideoElement, 100);

    return () => clearInterval(interval);
  }, []);

  return videoElement;
}

/**
 * Render text with active word highlighted
 * Splits text into words and highlights the matching word
 */
function renderTextWithActiveWord(text: string, activeWordText: string) {
  const words = text.split(/(\s+)/); // Split but keep whitespace

  return (
    <>
      {words.map((word, index) => {
        const isActive = word.trim() === activeWordText.trim();
        return (
          <span
            key={index}
            style={{
              color: isActive ? '#FFD700' : 'inherit', // Gold color for active word
              fontWeight: isActive ? 'bold' : 'inherit',
              textShadow: isActive ? '0 0 8px rgba(255, 215, 0, 0.8)' : 'inherit',
            }}
          >
            {word}
          </span>
        );
      })}
    </>
  );
}