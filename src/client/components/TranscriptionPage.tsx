import { Stack, Alert } from "@mui/material";
import { WorkflowIntro } from "./WorkflowIntro";
import { UploadStepSection } from "./UploadStepSection";
import { PreviewStepSection } from "./PreviewStepSection";
import type { TranscriptionWorkflow } from "../hooks/useTranscriptionWorkflow";

interface TranscriptionPageProps {
  workflow: TranscriptionWorkflow;
  onMyVideos: () => void;
}

export function TranscriptionPage({ workflow, onMyVideos }: TranscriptionPageProps) {
  const previewError = workflow.activePage === "preview" ? workflow.error : null;
  const uploading = workflow.activePage === "upload";

  return (
    <Stack useFlexGap spacing={{ xs: 1, sm: 4, md: workflow.activePage === "preview" ? 0 : 4 }} sx={{
      // A minimum (rather than fixed) height centers short forms and lets longer ones scroll.
      minHeight: { xs: uploading ? "calc(100dvh - 64px)" : undefined, sm: "auto" },
      justifyContent: { xs: uploading ? "center" : "flex-start", sm: "flex-start" },
    }}>
      <WorkflowIntro editing={workflow.activePage === "preview"} />

      <UploadStepSection
        active={workflow.activePage === "upload"}
        file={workflow.file}
        isSubmitting={workflow.isSubmitting}
        uploadProgress={workflow.uploadProgress}
        stages={workflow.stages}
        maxCharactersPerSubtitle={workflow.maxCharactersPerSubtitle}
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
