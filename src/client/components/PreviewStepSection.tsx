import { Fade, Stack } from "@mui/material";
import { TranscriptionResult } from "./TranscriptionResult";
import type { BurnOptions } from "./TranscriptionResult";
import type { ApiResponse, Segment } from "../types";

type PreviewStepSectionProps = {
  active: boolean;
  response: ApiResponse | null;
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
  mediaUrl: string | null;
  onBack: () => void;
  onBurn: (options: BurnOptions) => Promise<{ blob: Blob; filename?: string | undefined }>;
  onSaveSegments: (segments: Segment[], subtitleContent: string) => Promise<void>;
  videoId: number | null;
  isEditable: boolean;
};

export function PreviewStepSection({
  active,
  response,
  subtitleFormatLabel,
  downloadUrl,
  downloadName,
  mediaUrl,
  onBack,
  onBurn,
  onSaveSegments,
  videoId,
  isEditable,
}: PreviewStepSectionProps) {
  return (
    <Fade in={active} mountOnEnter unmountOnExit>
      <Stack>
        {response && (
          <TranscriptionResult
            response={response}
            subtitleFormatLabel={subtitleFormatLabel}
            downloadUrl={downloadUrl}
            downloadName={downloadName}
            mediaUrl={mediaUrl}
            onBack={onBack}
            onBurn={onBurn}
            onSaveSegments={onSaveSegments}
            videoId={videoId}
            isEditable={isEditable}
          />
        )}
      </Stack>
    </Fade>
  );
}
