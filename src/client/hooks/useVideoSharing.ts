import { useContext, useRef, useState } from "react";
import { DownloadContext } from "../contexts/DownloadContext";

type SharedVideo = { url: string; name: string };

async function shareFile(file: SharedVideo) {
  const blob = await fetch(file.url).then(result => result.blob());
  const name = file.name || "video-with-captions.mp4";
  const video = new File([blob], name, { type: name.endsWith(".mp4") ? "video/mp4" : blob.type || "video/mp4" });
  if (navigator.share && navigator.canShare?.({ files: [video] })) {
    await navigator.share({ files: [video], title: "סרטון עם כתוביות" });
    return true;
  }
  return false;
}

export function useVideoSharing(canShare: boolean, onBurnVideo: (options: { download: boolean; reuse: boolean }) => Promise<SharedVideo | null | void>) {
  const downloads = useContext(DownloadContext);
  const [sharing, setSharing] = useState(false);
  const [readyToShare, setReadyToShare] = useState<SharedVideo | null>(null);
  const flight = useRef(false);

  const shareVideo = async () => {
    if (!canShare || flight.current) return;
    flight.current = true;
    setSharing(true);
    try {
      const burned = await onBurnVideo({ download: false, reuse: true });
      if (!burned) return;
      try {
        if (!await shareFile(burned)) setReadyToShare(burned);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setReadyToShare(burned);
      }
    } finally {
      flight.current = false;
      setSharing(false);
    }
  };

  const shareReadyVideo = async () => {
    if (!readyToShare) return;
    try {
      if (await shareFile(readyToShare)) { setReadyToShare(null); return; }
      if (await downloads.downloadVideo(readyToShare)) setReadyToShare(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  };

  return { sharing, readyToShare, closeShare: () => setReadyToShare(null), shareVideo, shareReadyVideo };
}
