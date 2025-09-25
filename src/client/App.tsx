import { useState } from "react";
import { Alert, Box, Container, CssBaseline, Stack, ThemeProvider, createTheme } from "@mui/material";
import { AppHeader } from "./components/AppHeader";
import { PreviewStepSection } from "./components/PreviewStepSection";
import { UploadStepSection } from "./components/UploadStepSection";
import { WorkflowIntro } from "./components/WorkflowIntro";
import { WorkflowStepper } from "./components/WorkflowStepper";
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

function App() {
  const workflow = useTranscriptionWorkflow();
  const [currentPage, setCurrentPage] = useState<"home" | "videos">("home");
  const activeStep = workflow.activePage === "upload" ? 0 : 1;
  const previewError = workflow.activePage === "preview" ? workflow.error : null;

  const handleEditVideo = async (videoId: number) => {
    if (!workflow.user?.uid) return;

    try {
      const url = `${API_BASE_URL || ""}/api/videos/${videoId}?userUid=${encodeURIComponent(workflow.user.uid)}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to load video");
      }
      const data = await response.json();
      const video = data.video;

      if (video.subtitle_json) {
        const segments = typeof video.subtitle_json === "string"
          ? JSON.parse(video.subtitle_json)
          : video.subtitle_json;

        const mediaUrl = video.stored_path
          ? `${API_BASE_URL || ""}/api/videos/${videoId}/media?userUid=${encodeURIComponent(workflow.user.uid)}`
          : null;

        workflow.onLoadVideo({
          videoId: video.id,
          segments,
          format: video.format || ".srt",
          filename: video.original_filename,
          mediaUrl,
        });
        setCurrentPage("home");
      }
    } catch (error) {
      console.error("Failed to load video:", error);
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
          currentPage={currentPage}
          onProfileClick={workflow.onProfileClick}
          onProfileClose={workflow.onProfileClose}
          onSignIn={workflow.onSignIn}
          onSignOut={workflow.onSignOut}
          onNavigate={setCurrentPage}
        />

        <Container maxWidth="100%" sx={{ py: { xs: 4, md: 6 }, mt: { xs: 12, md: 10 } }}>
          {currentPage === "home" ? (
            <Stack spacing={4}>
              <WorkflowIntro />

              <WorkflowStepper steps={workflow.steps} activeStep={activeStep} />

              <UploadStepSection
                active={workflow.activePage === "upload"}
                file={workflow.file}
                format={workflow.format}
                isSubmitting={workflow.isSubmitting}
                uploadProgress={workflow.uploadProgress}
                stages={workflow.stages}
                formatOptions={workflow.supportedFormats}
                error={workflow.activePage === "upload" ? workflow.error : null}
                onFileChange={workflow.onFileChange}
                onFormatChange={workflow.onFormatChange}
                onSubmit={workflow.onSubmit}
              />

              <PreviewStepSection
                active={workflow.activePage === "preview"}
                response={workflow.response}
                subtitleFormatLabel={workflow.subtitleFormatLabel}
                downloadUrl={workflow.downloadUrl}
                downloadName={workflow.downloadName}
                mediaUrl={workflow.mediaPreviewUrl}
                onBack={workflow.onBackToUpload}
                onBurn={workflow.onBurnVideoRequest}
                onSaveSegments={workflow.onSaveSegments}
                videoId={workflow.videoId}
                isEditable={Boolean(workflow.videoId && workflow.user)}
              />

              {previewError && <Alert severity="error">{previewError}</Alert>}
            </Stack>
          ) : (
            <VideosPage onEditVideo={handleEditVideo} />
          )}
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default App;
