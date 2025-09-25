import { useEffect, useRef, useState } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { VideoLibraryRounded } from "@mui/icons-material";

type VideoPlayerProps = {
  mediaUrl: string | null;
  activeSegmentText: string | null;
  previewStyle: React.CSSProperties;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (dimensions: { width: number; height: number }, duration: number) => void;
  onResize?: (dimensions: { width: number; height: number }) => void;
};

export function VideoPlayer({
  mediaUrl,
  activeSegmentText,
  previewStyle,
  onTimeUpdate,
  onLoadedMetadata,
  onResize,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
              <Box sx={previewStyle}>{activeSegmentText}</Box>
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