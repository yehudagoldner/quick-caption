import { apiFetch } from "./api";
import { useState, useEffect, useRef, useCallback } from "react";
import { Alert, Box, CircularProgress, Container, CssBaseline, Stack, ThemeProvider, createTheme, useMediaQuery } from "@mui/material";
import { AppHeader } from "./components/AppHeader";
import { PromotionalHome } from "./components/PromotionalHome";
import { TranscriptionPage } from "./components/TranscriptionPage";
import { VideoEditPage } from "./components/VideoEditPage";
import { VideosPage } from "./components/VideosPage";
import { BuyCreditsPage } from "./components/BuyCreditsPage";
import { AdminPage } from "./components/AdminPage";
import { IssueReportDialog } from "./components/IssueReportDialog";
import { adminRequest } from "./adminApi";
import { useTranscriptionWorkflow } from "./hooks/useTranscriptionWorkflow";
import { useNarrowViewport } from "./hooks/useNarrowViewport";
import { DESKTOP_APP_HEADER_HEIGHT, MOBILE_APP_HEADER_HEIGHT } from "./utils/appLayout";
import { EditorNavigationContext, type EditorNavigationGuard } from "./contexts/EditorNavigationContext";
import { EditorHeaderContext, type EditorHeaderActions } from "./contexts/EditorHeaderContext";
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
const APP_BASE_PATH = import.meta.env.BASE_URL;

type AppScreen = "home" | "transcription" | "videos" | "edit" | "buy-credits" | "admin";

function getScreenFromUrl(): { screen: AppScreen; videoToken?: string } {
  if (window.location.pathname.replace(/\/$/, '') === `${APP_BASE_PATH}admin`) return { screen: 'admin' };
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
  if (screen === 'admin') { window.history.pushState({ editorIndex: Number(window.history.state?.editorIndex ?? 0) + 1 }, '', `${APP_BASE_PATH}admin`); return; }
  const params = new URLSearchParams();
  if (screen !== "home") {
    params.set("screen", screen);
  }
  if (videoToken) {
    params.set("video", videoToken);
  }

  const newUrl = params.toString() ? `${APP_BASE_PATH}?${params.toString()}` : APP_BASE_PATH;
  window.history.pushState({ editorIndex: Number(window.history.state?.editorIndex ?? 0) + 1 }, "", newUrl);
}

function App() {
  const workflow = useTranscriptionWorkflow();
  const narrow = useNarrowViewport();
  const headerHeight = narrow ? MOBILE_APP_HEADER_HEIGHT : DESKTOP_APP_HEADER_HEIGHT;
  const desktopHome = useMediaQuery(theme.breakpoints.up("md"));
  const [currentScreen, setCurrentScreen] = useState<AppScreen>("home");
  const [videoToken, setVideoToken] = useState<string | undefined>();
  const [projectError, setProjectError] = useState<string | null>(null);
  const openingProject = useRef(false);
  const historyIndex = useRef(Number(window.history.state?.editorIndex ?? 0));
  const [credits, setCredits] = useState<number | null>(null);
  const [adminUid, setAdminUid] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  useEffect(() => { setReportOpen(false); }, [workflow.user?.uid]);
  useEffect(() => {
    let cancelled = false;
    setAdminUid(null);
    if (workflow.user) {
      const user = workflow.user;
      void adminRequest<{ isAdmin: boolean }>(user, '/session').then(session => {
        if (!cancelled) setAdminUid(session.isAdmin ? user.uid : null);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [workflow.user]);
  const editorNavigation = useRef<EditorNavigationGuard | null>(null);
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const [editorHeaderActions, setEditorHeaderActions] = useState<EditorHeaderActions | null>(null);
  const registerEditorNavigation = useCallback((guard: EditorNavigationGuard | null, blocked = false) => {
    editorNavigation.current = guard;
    setNavigationBlocked(blocked);
  }, []);
  const editing = currentScreen === "edit" || (currentScreen === "transcription" && workflow.activePage === "preview");
  const marketingHome = currentScreen === "home";

  useEffect(() => {
    window.history.replaceState({ ...window.history.state, editorIndex: historyIndex.current }, '', window.location.href);
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
      const response = await apiFetch(`${API_BASE_URL || ""}/api/users/credits?userUid=${encodeURIComponent(workflow.user.uid)}`);
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
    let pendingTarget: number | null = null;
    let accepting = false;
    const handlePopState = () => {
      const target = Number(window.history.state?.editorIndex ?? historyIndex.current - 1);
      if (pendingTarget !== null && target === historyIndex.current) {
        const destinationIndex = pendingTarget;
        pendingTarget = null;
        const destination = () => { accepting = true; window.history.go(destinationIndex - historyIndex.current); };
        if (editorNavigation.current) void editorNavigation.current(destination);
        else destination();
        return;
      }
      if (!accepting && editorNavigation.current && target !== historyIndex.current) {
        pendingTarget = target;
        window.history.go(historyIndex.current - target);
        return;
      }
      accepting = false;
      historyIndex.current = target;
      const { screen, videoToken: token } = getScreenFromUrl();
      setCurrentScreen(screen);
      setVideoToken(token);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateToScreen = (screen: AppScreen, token?: string) => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    setCurrentScreen(screen);
    setVideoToken(token);
    updateUrl(screen, token);
    historyIndex.current = Number(window.history.state.editorIndex);
  };

  const handleNewVideo = () => {
    workflow.onBackToUpload();
    navigateToScreen("transcription");
  };

  const handleEditVideo = async (videoId: number) => {
    if (!workflow.user?.uid || openingProject.current) return;
    openingProject.current = true;
    setProjectError(null);
    try {
      // Generate secure token for video editing
      const tokenResponse = await apiFetch(`${API_BASE_URL || ""}/api/videos/${videoId}/token?userUid=${encodeURIComponent(workflow.user.uid)}`);
      if (!tokenResponse.ok) {
        throw new Error("Failed to generate video token");
      }
      const { token } = await tokenResponse.json();
      if (typeof token !== "string" || !token) throw new Error("Invalid video session");

      navigateToScreen("edit", token);
    } catch (error) {
      console.error("Failed to create video edit session:", error);
      setProjectError("לא ניתן לפתוח את הפרויקט כרגע. נסו שוב באמצעות המשך עריכה.");
    } finally { openingProject.current = false; }
  };

  const handleSaveSegments = async (segments: any[], _subtitleContent?: string, words?: any[]) => {
    if (!videoToken || !workflow.user?.uid) {
      throw new Error("Invalid session");
    }

    const result = await apiFetch(`${API_BASE_URL || ""}/api/videos/update-subtitles`, {
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
    const destination = () => navigateToScreen("buy-credits");
    if (editorNavigation.current) void editorNavigation.current(destination);
    else destination();
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <EditorNavigationContext.Provider value={registerEditorNavigation}>
      <EditorHeaderContext.Provider value={setEditorHeaderActions}>
      <Box sx={{ minHeight: "100vh", display: "flow-root", bgcolor: "background.default" }}>
        <AppHeader
          editorActions={editing ? editorHeaderActions : null}
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
          onSignOut={async () => {
            const destination = () => { void workflow.onSignOut(); };
            if (editorNavigation.current) await editorNavigation.current(destination);
            else destination();
          }}
          navigationBlocked={navigationBlocked}
          onNavigate={(page) => {
            const navigate = () => {
              if (page === "transcription") handleNewVideo();
              else navigateToScreen(page);
            };
            if (editorNavigation.current) void editorNavigation.current(navigate);
            else navigate();
          }}
          onBuyCredits={handleBuyCredits}
          onReportIssue={() => setReportOpen(true)}
          isAdmin={Boolean(workflow.user && adminUid === workflow.user.uid)}
          onAdmin={() => {
            const navigate = () => navigateToScreen('admin');
            if (editorNavigation.current) void editorNavigation.current(navigate);
            else navigate();
          }}
        />

        {reportOpen && workflow.user && <IssueReportDialog user={workflow.user} screen={currentScreen} onClose={() => setReportOpen(false)} />}

        <Container maxWidth={false} disableGutters={marketingHome} sx={{
          pt: marketingHome ? 0 : narrow && currentScreen === "transcription" ? `${headerHeight}px` : { xs: currentScreen === "transcription" ? 7 : 2, md: editing ? 1 : currentScreen === "transcription" ? 1.5 : 6 },
          pb: marketingHome ? 0 : { xs: currentScreen === "transcription" ? 1 : 2, md: editing ? 1 : currentScreen === "transcription" ? 1.5 : 6 },
          px: marketingHome ? 0 : { xs: 1.5, md: 3 },
          mt: marketingHome ? `${headerHeight}px` : { xs: currentScreen === "transcription" ? 0 : 10, md: currentScreen === "transcription" ? 7 : editing ? 7 : 10 },
        }}>
          {projectError && <Alert severity="error" onClose={() => setProjectError(null)} sx={{ mb: 2 }}>{projectError}</Alert>}
          {currentScreen === "home" && workflow.error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {workflow.error}
            </Alert>
          )}

          {currentScreen === "home" && workflow.authLoading && !desktopHome && (
            <Stack alignItems="center" py={8}>
              <CircularProgress />
            </Stack>
          )}

          {currentScreen === "home" && (desktopHome || !workflow.authLoading) && (
            <PromotionalHome
              authLoading={workflow.authLoading}
              onSignIn={workflow.onSignIn}
              isAuthenticated={Boolean(workflow.user)}
              onStart={handleNewVideo}
              onMyVideos={() => navigateToScreen("videos")}
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
              onEditVideo={handleEditVideo}
              onNewVideo={handleNewVideo}
            />
          )}

          {currentScreen === "buy-credits" && (
            <BuyCreditsPage
              user={workflow.user}
              currentCredits={credits}
              onCreditsUpdated={fetchCredits}
            />
          )}

          {currentScreen === 'admin' && <AdminPage key={workflow.user?.uid ?? 'guest'} />}

          {currentScreen === "edit" && videoToken && (
            <VideoEditPage
              user={workflow.user}
              videoToken={videoToken}
              onSaveSegments={handleSaveSegments}
              onNewUpload={handleNewVideo}
              onMyVideos={() => navigateToScreen("videos")}
            />
          )}
        </Container>
      </Box>
      </EditorHeaderContext.Provider>
      </EditorNavigationContext.Provider>
    </ThemeProvider>
  );
}

export default App;
