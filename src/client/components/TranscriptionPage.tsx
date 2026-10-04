import { Stack, Alert } from "@mui/material";
import { WorkflowIntro } from "./WorkflowIntro";
import { UploadStepSection } from "./UploadStepSection";
import { PreviewStepSection } from "./PreviewStepSection";
import type { TranscriptionWorkflow } from "../hooks/useTranscriptionWorkflow";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
import { DESKTOP_APP_HEADER_HEIGHT, MOBILE_APP_HEADER_HEIGHT } from "../utils/appLayout";

interface TranscriptionPageProps {
  workflow: TranscriptionWorkflow;
  onMyVideos: () => void;
}

export function TranscriptionPage({ workflow, onMyVideos }: TranscriptionPageProps) {
  const previewError = workflow.activePage === "preview" ? workflow.error : null;
  const uploading = workflow.activePage === "upload";
  const headerHeight = useNarrowViewport() ? MOBILE_APP_HEADER_HEIGHT : DESKTOP_APP_HEADER_HEIGHT;

  return (
    <Stack useFlexGap spacing={uploading ? 1.5 : 0} sx={{
      minHeight: uploading ? { xs: `calc(100dvh - ${headerHeight + 8}px)`, md: "calc(100dvh - 80px)" } : undefined,
      justifyContent: uploading ? "center" : "flex-start",
      maxWidth: uploading ? 760 : undefined,
      mx: uploading ? "auto" : undefined,
    }}>
      <WorkflowIntro editing={workflow.activePage === "preview"} />

      <UploadStepSection
        active={workflow.activePage === "upload"}
        file={workflow.file}
        isSubmitting={workflow.isSubmitting}
        uploadProgress={workflow.uploadProgress}
        stages={workflow.stages}
        maxCharactersPerSubtitle={workflow.maxCharactersPerSubtitle}
        subtitleLimitMode={workflow.subtitleLimitMode}
        maxWordsPerSubtitle={workflow.maxWordsPerSubtitle}
        languages={workflow.languages}
        onSubtitleLimitModeChange={workflow.onSubtitleLimitModeChange}
        onMaxWordsChange={workflow.onMaxWordsChange}
        onLanguagesChange={workflow.onLanguagesChange}
        error={workflow.activePage === "upload" ? workflow.error : null}
        onFileChange={workflow.onFileChange}
        onMaxCharactersChange={workflow.onMaxCharactersChange}
        onSubmit={workflow.onSubmit}
        onBackToUpload={workflow.onBackToUpload}
      />

      <PreviewStepSection
        active={workflow.activePage === "preview"}
        response={workflow.response}
        subtitleFormatLabel={workflow.subtitleFormatLabel}
        downloadUrl={workflow.downloadUrl}
        downloadName={workflow.downloadName}
        mediaUrl={workflow.mediaPreviewUrl}
        onBack={workflow.onBackToUpload}
        onMyVideos={onMyVideos}
        onBurn={workflow.onBurnVideoRequest}
        onSaveSegments={workflow.onSaveSegments}
        videoId={workflow.videoId}
        isEditable={Boolean(workflow.videoId && workflow.user)}
      />

      {previewError && <Alert severity="error">{previewError}</Alert>}
    </Stack>
  );
}
