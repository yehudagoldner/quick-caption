import { useContext, useEffect, useRef, useState } from "react";
import { DownloadContext } from "../contexts/DownloadContext";

type SharedVideo = { url: string; name: string };
type PreparedVideo = SharedVideo & { file: File | null };

export function useVideoSharing(canShare: boolean, onBurnVideo: (options: { download: boolean; reuse: boolean }) => Promise<SharedVideo | null | void>) {
  const downloads = useContext(DownloadContext);
  const [sharing, setSharing] = useState(false);
  const [readyToShare, setReadyToShare] = useState<PreparedVideo | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const flight = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;

  const shareVideo = async () => {
    if (!canShare || flight.current) return;
    const version = generation.current;
    flight.current = true;
    setSharing(true);
    setShareError(null);
    setReadyToShare(null);
    try {
      const burned = await onBurnVideo({ download: false, reuse: true });
      if (!burned || version !== generation.current) return;
      let file: File | null = null;
      if (typeof navigator.share === "function" && typeof navigator.canShare === "function") {
        const response = await fetch(burned.url);
        if (!response.ok) throw new Error("Video preparation failed");
        const blob = await response.blob();
        if (!blob.size) throw new Error("Empty video");
        const name = /\.mp4$/i.test(burned.name) ? burned.name : `${burned.name || "video-with-captions"}.mp4`;
        const candidate = new File([blob], name, { type: "video/mp4" });
        if (navigator.canShare({ files: [candidate] })) file = candidate;
      }
      // A second, explicit tap opens the native sheet. No fetching or encoding
      // may happen between that tap and navigator.share (Safari activation).
      if (version === generation.current) setReadyToShare({ ...burned, file });
    } catch {
      if (version === generation.current) setShareError("לא ניתן להכין את הסרטון לשיתוף. נסו שוב או הורידו אותו כקובץ.");
    } finally {
      flight.current = false;
      if (version === generation.current) setSharing(false);
    }
  };

  const shareReadyVideo = async () => {
    if (!readyToShare?.file || flight.current) return;
    flight.current = true;
    setSharing(true);
    setShareError(null);
    try {
      // Invoke synchronously in the click handler, before the first await.
      await navigator.share({ files: [readyToShare.file], title: "סרטון עם כתוביות" });
      setReadyToShare(null);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setShareError("לא ניתן לפתוח את השיתוף. נסו שוב או בחרו הורדה לקבצים.");
      }
    } finally {
      flight.current = false;
      setSharing(false);
    }
  };

  const downloadReadyVideo = async () => {
    if (!readyToShare || flight.current) return;
    flight.current = true;
    setSharing(true);
    setShareError(null);
    try {
      if (await downloads.downloadVideo(readyToShare)) setReadyToShare(null);
      else setShareError("ההורדה נכשלה. נסו שוב.");
    } catch {
      setShareError("ההורדה נכשלה. נסו שוב.");
    } finally {
      flight.current = false;
      setSharing(false);
    }
  };

  const closeShare = () => {
    if (flight.current) return;
    setReadyToShare(null);
    setShareError(null);
  };
  return { sharing, readyToShare, shareError, isAppleMobile, closeShare, shareVideo, shareReadyVideo, downloadReadyVideo };
}
