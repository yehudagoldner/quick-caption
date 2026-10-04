import type { FormEvent } from "react";
import { Alert, Card, CardContent, Fade, Stack } from "@mui/material";
import { UploadForm } from "./UploadForm";
import type { StageState } from "../types";
import type { InitialTranscriptionSettingsProps } from "./InitialTranscriptionSettings";

type UploadStepSectionProps = InitialTranscriptionSettingsProps & {
  active: boolean;
  file: File | null;
  isSubmitting: boolean;
  uploadProgress: number | null;
  stages: StageState[];
  maxCharactersPerSubtitle: number;
  error: string | null;
  onFileChange: (file: File | null) => void;
  onMaxCharactersChange: (value: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBackToUpload: () => void;
};

export function UploadStepSection({
  active,
  file,
  isSubmitting,
  uploadProgress,
  stages,
  maxCharactersPerSubtitle,
  error,
  onFileChange,
  onMaxCharactersChange,
  onSubmit,
  onBackToUpload,
  ...settings
}: UploadStepSectionProps) {
  return (
    <Fade in={active} mountOnEnter unmountOnExit>
      <Card elevation={3}>
        <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
          <Stack spacing={1}>
            <UploadForm
              {...settings}
              file={file}
              isSubmitting={isSubmitting}
              uploadProgress={uploadProgress}
              stages={stages}
              maxCharactersPerSubtitle={maxCharactersPerSubtitle}
              onFileChange={onFileChange}
              onMaxCharactersChange={onMaxCharactersChange}
              onSubmit={onSubmit}
              onBackToUpload={onBackToUpload}
            />

            {error && active && <Alert severity="error">{error}</Alert>}
          </Stack>
        </CardContent>
      </Card>
    </Fade>
  );
}
