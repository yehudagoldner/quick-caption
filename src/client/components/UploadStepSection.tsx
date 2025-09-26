import type { FormEvent } from "react";
import { Alert, Card, CardContent, Divider, Fade, Stack, Typography } from "@mui/material";
import { CloudUploadRounded } from "@mui/icons-material";
import { UploadForm } from "./UploadForm";
import type { StageState } from "../types";
import type { FormatOption } from "../hooks/useTranscriptionWorkflow";

type UploadStepSectionProps = {
  active: boolean;
  file: File | null;
  format: string;
  isSubmitting: boolean;
  uploadProgress: number | null;
  stages: StageState[];
  formatOptions: FormatOption[];
  error: string | null;
  onFileChange: (file: File | null) => void;
  onFormatChange: (format: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function UploadStepSection({
  active,
  file,
  format,
  isSubmitting,
  uploadProgress,
  stages,
  formatOptions,
  error,
  onFileChange,
  onFormatChange,
  onSubmit,
}: UploadStepSectionProps) {
  return (
    <Fade in={active} mountOnEnter unmountOnExit>
      <Card elevation={3}>
        <CardContent>
          <Stack spacing={3}>
            <UploadForm
              file={file}
              format={format}
              isSubmitting={isSubmitting}
              uploadProgress={uploadProgress}
              stages={stages}
              formatOptions={formatOptions}
              onFileChange={onFileChange}
              onFormatChange={onFormatChange}
              onSubmit={onSubmit}
            />

            {error && active && <Alert severity="error">{error}</Alert>}
          </Stack>
        </CardContent>
      </Card>
    </Fade>
  );
}
