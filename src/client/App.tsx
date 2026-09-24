import { useState, useEffect } from "react";
import { Alert, Box, CircularProgress, Container, CssBaseline, Stack, ThemeProvider, createTheme } from "@mui/material";
import { AppHeader } from "./components/AppHeader";
import { PromotionalHome } from "./components/PromotionalHome";
import { TranscriptionPage } from "./components/TranscriptionPage";
import { VideoEditPage } from "./components/VideoEditPage";
import { VideosPage } from "./components/VideosPage";
import { BuyCreditsPage } from "./components/BuyCreditsPage";
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

type AppScreen = "home" | "transcription" | "videos" | "edit" | "buy-credits";

function getScreenFromUrl(): { screen: AppScreen; videoToken?: string } {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get("screen") as AppScreen;
  const videoToken = params.get("video");

  if (screen === "edit" && videoToken) {
    return { screen: "edit", videoToken };
  }

  if (["transcription", "videos", "buy-credits"].includes(screen)) {
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
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    const { screen, videoToken: token } = getScreenFromUrl();
    setCurrentScreen(screen);
    setVideoToken(token);
  }, []);

  // Fetch user credits when user is authenticated
  useEffect(() => {
    if (workflow.user?.uid) {
      fetchCredits();
    } else {
      setCredits(null);
    }
  }, [workflow.user?.uid]);

  const fetchCredits = async () => {
    if (!workflow.user?.uid) return;

    try {
      const response = await fetch(`${API_BASE_URL || ""}/api/users/credits?userUid=${encodeURIComponent(workflow.user.uid)}`);
      if (response.ok) {
        const data = await response.json();
        setCredits(data.credits);
      }
    } catch (error) {
      console.error("Failed to fetch credits:", error);
    }
  };

  // Refresh credits when transcription completes (activePage changes to preview)
  useEffect(() => {
    if (workflow.activePage === "preview" && workflow.user?.uid) {
      fetchCredits();
    }
  }, [workflow.activePage, workflow.user?.uid]);

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

  const handleSaveSegments = async (segments: any[], _subtitleContent?: string, words?: any[]) => {
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
        wordsJson: words ? JSON.stringify(words) : undefined,
      }),
    });

    if (!result.ok) {
      throw new Error("Failed to save segments");
    }
  };

  const handleBuyCredits = () => {
    navigateToScreen("buy-credits");
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <AppHeader
          user={workflow.user}
          authLoading={workflow.authLoading}
          profileAnchorEl={workflow.profileAnchorEl}
          currentPage={
            currentScreen === "transcription"
              ? "transcription"
              : currentScreen === "videos" || currentScreen === "edit"
                ? "videos"
                : "home"
          }
          credits={credits}
          onProfileClick={workflow.onProfileClick}
          onProfileClose={workflow.onProfileClose}
          onSignIn={workflow.onSignIn}
          onSignOut={workflow.onSignOut}
          onNavigate={(page) => navigateToScreen(page)}
          onBuyCredits={handleBuyCredits}
        />

        <Container maxWidth={false} sx={{
          pt: { xs: currentScreen === "transcription" ? 7 : 2, md: 6 },
          pb: { xs: currentScreen === "transcription" ? 1 : 2, md: 6 },
          px: { xs: 1.5, md: 3 },
          mt: { xs: currentScreen === "transcription" ? 0 : 10, md: 10 },
        }}>
          {currentScreen === "home" && workflow.error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {workflow.error}
            </Alert>
          )}

          {currentScreen === "home" && workflow.authLoading && (
            <Stack alignItems="center" py={8}>
              <CircularProgress />
            </Stack>
          )}

          {currentScreen === "home" && !workflow.authLoading && !workflow.user && (
            <PromotionalHome
              authLoading={workflow.authLoading}
              onSignIn={workflow.onSignIn}
            />
          )}

          {currentScreen === "home" && !workflow.authLoading && workflow.user && (
            <VideosPage
              variant="workspace"
              onEditVideo={handleEditVideo}
              onNewVideo={() => navigateToScreen("transcription")}
            />
          )}

          {currentScreen === "transcription" && (
            <TranscriptionPage
              workflow={workflow}
              onMyVideos={() => navigateToScreen("videos")}
            />
          )}

          {currentScreen === "videos" && (
            <VideosPage
              variant="history"
              onEditVideo={handleEditVideo}
              onNewVideo={() => navigateToScreen("transcription")}
            />
          )}

          {currentScreen === "buy-credits" && (
            <BuyCreditsPage
              user={workflow.user}
              currentCredits={credits}
              onCreditsUpdated={fetchCredits}
            />
          )}

          {currentScreen === "edit" && videoToken && (
            <VideoEditPage
              user={workflow.user}
              videoToken={videoToken}
              onSaveSegments={handleSaveSegments}
              onNewUpload={() => {
                workflow.onBackToUpload();
                navigateToScreen("transcription");
              }}
              onMyVideos={() => navigateToScreen("videos")}
            />
          )}
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default App;
