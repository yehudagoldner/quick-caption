import type { FormEvent } from "react";
import { Alert, Card, CardContent, Fade, Stack } from "@mui/material";
import { UploadForm } from "./UploadForm";
import type { StageState } from "../types";

type UploadStepSectionProps = {
  active: boolean;
  file: File | null;
  isSubmitting: boolean;
  uploadProgress: number | null;
  stages: StageState[];
  error: string | null;
  onFileChange: (file: File | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function UploadStepSection({
  active,
  file,
  isSubmitting,
  uploadProgress,
  stages,
  error,
  onFileChange,
  onSubmit,
}: UploadStepSectionProps) {
  return (
    <Fade in={active} mountOnEnter unmountOnExit>
      <Card elevation={3}>
        <CardContent>
          <Stack spacing={3}>
            <UploadForm
              file={file}
              isSubmitting={isSubmitting}
              uploadProgress={uploadProgress}
              stages={stages}
              onFileChange={onFileChange}
              onSubmit={onSubmit}
            />

            {error && active && <Alert severity="error">{error}</Alert>}
          </Stack>
        </CardContent>
      </Card>
    </Fade>
  );
}
