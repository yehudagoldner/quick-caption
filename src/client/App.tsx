import { useState, useEffect } from "react";
import { Box, Container, CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { AppHeader } from "./components/AppHeader";
import { PromotionalHome } from "./components/PromotionalHome";
import { TranscriptionPage } from "./components/TranscriptionPage";
import { VideoEditPage } from "./components/VideoEditPage";
import { VideosPage } from "./components/VideosPage";
import { useTranscriptionWorkflow } from "./hooks/useTranscriptionWorkflow";
import "./App.css";

const theme = createTheme({
  direction: "rtl",
  typography: {
    fontFamily: '"Rubik", "Assistant", "Segoe UI", sans-serif',
  },
  shape: {
    borderRadius: 16,
  },
});

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
const API_BASE_URL = RAW_API_BASE.replace(/\/?$/, "");

type AppScreen = "home" | "transcription" | "videos" | "edit";

function getScreenFromUrl(): { screen: AppScreen; videoToken?: string } {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get("screen") as AppScreen;
  const videoToken = params.get("video");

  if (screen === "edit" && videoToken) {
    return { screen: "edit", videoToken };
  }

  if (["transcription", "videos"].includes(screen)) {
    return { screen };
  }

  return { screen: "home" };
}

function updateUrl(screen: AppScreen, videoToken?: string) {
  const params = new URLSearchParams();
  if (screen !== "home") {
    params.set("screen", screen);
  }
  if (videoToken) {
    params.set("video", videoToken);
  }

  const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
  window.history.pushState(null, "", newUrl);
}

function App() {
  const workflow = useTranscriptionWorkflow();
  const [currentScreen, setCurrentScreen] = useState<AppScreen>("home");
  const [videoToken, setVideoToken] = useState<string | undefined>();

  useEffect(() => {
    const { screen, videoToken: token } = getScreenFromUrl();
    setCurrentScreen(screen);
    setVideoToken(token);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const { screen, videoToken: token } = getScreenFromUrl();
      setCurrentScreen(screen);
      setVideoToken(token);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateToScreen = (screen: AppScreen, token?: string) => {
    setCurrentScreen(screen);
    setVideoToken(token);
    updateUrl(screen, token);
  };

  const handleEditVideo = async (videoId: number) => {
    if (!workflow.user?.uid) return;

    try {
      // Generate secure token for video editing
      const tokenResponse = await fetch(`${API_BASE_URL || ""}/api/videos/${videoId}/token?userUid=${encodeURIComponent(workflow.user.uid)}`);
      if (!tokenResponse.ok) {
        throw new Error("Failed to generate video token");
      }
      const { token } = await tokenResponse.json();

      navigateToScreen("edit", token);
    } catch (error) {
      console.error("Failed to create video edit session:", error);
    }
  };

  const handleSaveSegments = async (segments: any[]) => {
    if (!videoToken || !workflow.user?.uid) {
      throw new Error("Invalid session");
    }

    const result = await fetch(`${API_BASE_URL || ""}/api/videos/update-subtitles`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: videoToken,
        userUid: workflow.user.uid,
        subtitleJson: JSON.stringify(segments),
      }),
    });

    if (!result.ok) {
      throw new Error("Failed to save segments");
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <AppHeader
          user={workflow.user}
          authLoading={workflow.authLoading}
          profileAnchorEl={workflow.profileAnchorEl}
          currentPage={currentScreen === "videos" ? "videos" : "home"}
          onProfileClick={workflow.onProfileClick}
          onProfileClose={workflow.onProfileClose}
          onSignIn={workflow.onSignIn}
          onSignOut={workflow.onSignOut}
          onNavigate={(page) => navigateToScreen(page === "videos" ? "videos" : "home")}
        />

        <Container maxWidth={false} sx={{ py: { xs: 4, md: 6 }, mt: { xs: 12, md: 10 } }}>
          {currentScreen === "home" && (
            <PromotionalHome
              user={workflow.user}
              authLoading={workflow.authLoading}
              onTryNow={() => navigateToScreen("transcription")}
              onSignIn={workflow.onSignIn}
            />
          )}

          {currentScreen === "transcription" && (
            <TranscriptionPage
              workflow={workflow}
            />
          )}

          {currentScreen === "videos" && (
            <VideosPage onEditVideo={handleEditVideo} />
          )}

          {currentScreen === "edit" && videoToken && (
            <VideoEditPage
              user={workflow.user}
              videoToken={videoToken}
              onSaveSegments={handleSaveSegments}
            />
          )}
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default App;
