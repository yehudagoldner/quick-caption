import { Alert, Box, Container, CssBaseline, Stack, ThemeProvider, createTheme } from "@mui/material";
import { AppHeader } from "./components/AppHeader";
import { PreviewStepSection } from "./components/PreviewStepSection";
import { UploadStepSection } from "./components/UploadStepSection";
import { WorkflowIntro } from "./components/WorkflowIntro";
import { WorkflowStepper } from "./components/WorkflowStepper";
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

function App() {
  const workflow = useTranscriptionWorkflow();
  const activeStep = workflow.activePage === "upload" ? 0 : 1;
  const previewError = workflow.activePage === "preview" ? workflow.error : null;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <AppHeader
          user={workflow.user}
          authLoading={workflow.authLoading}
          profileAnchorEl={workflow.profileAnchorEl}
          onProfileClick={workflow.onProfileClick}
          onProfileClose={workflow.onProfileClose}
          onSignIn={workflow.onSignIn}
          onSignOut={workflow.onSignOut}
        />

        <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 }, mt: { xs: 12, md: 10 } }}>
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
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default App;
