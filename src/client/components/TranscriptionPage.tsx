import { Stack, Alert } from "@mui/material";
import { WorkflowIntro } from "./WorkflowIntro";
import { UploadStepSection } from "./UploadStepSection";
import { PreviewStepSection } from "./PreviewStepSection";
import type { TranscriptionWorkflow } from "../hooks/useTranscriptionWorkflow";

interface TranscriptionPageProps {
  workflow: TranscriptionWorkflow;
}

export function TranscriptionPage({ workflow }: TranscriptionPageProps) {
  const previewError = workflow.activePage === "preview" ? workflow.error : null;

  return (
    <Stack spacing={4}>
      <WorkflowIntro />

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
  );
}