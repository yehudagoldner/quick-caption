import { useCallback, useEffect, useState } from "react";

export function useVideoControls(videoPlayer: HTMLVideoElement | null) {
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlayPause = useCallback(async () => {
    if (!videoPlayer) {
      console.log('No video player available');
      return;
    }

    try {
      if (videoPlayer.paused) {
        console.log('Playing video');
        await videoPlayer.play();
        setIsPlaying(true);
      } else {
        console.log('Pausing video');
        videoPlayer.pause();
        setIsPlaying(false);
      }
    } catch (error) {
      console.error('Error controlling video playback:', error);
    }
  }, [videoPlayer]);

  // Update isPlaying state when video play/pause events occur
  useEffect(() => {
    if (!videoPlayer) {
      setIsPlaying(false);
      return;
    }

    // Set initial state based on video's current state
    setIsPlaying(!videoPlayer.paused);

    const handlePlay = () => {
      console.log('Video play event');
      setIsPlaying(true);
    };

    const handlePause = () => {
      console.log('Video pause event');
      setIsPlaying(false);
    };

    const handleEnded = () => {
      console.log('Video ended event');
      setIsPlaying(false);
    };

    videoPlayer.addEventListener('play', handlePlay);
    videoPlayer.addEventListener('pause', handlePause);
    videoPlayer.addEventListener('ended', handleEnded);

    return () => {
      videoPlayer.removeEventListener('play', handlePlay);
      videoPlayer.removeEventListener('pause', handlePause);
      videoPlayer.removeEventListener('ended', handleEnded);
    };
  }, [videoPlayer]);

  return {
    isPlaying,
    handlePlayPause,
  };
}