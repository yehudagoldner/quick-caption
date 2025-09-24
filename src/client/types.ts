export type Segment = {
  id: number | string;
  start: number;
  end: number;
  text: string;
};

export type SubtitlePayload = {
  format: string;
  content: string;
};

export type ApiResponse = {
  text: string;
  segments: Segment[];
  subtitle: SubtitlePayload;
  warnings?: string[];
  error?: string;
  videoId?: number | null;
};

export type StageId =
  | "upload"
  | "timed-transcription"
  | "high-accuracy"
  | "correction"
  | "complete";

export type StageStatus = "idle" | "active" | "done" | "skipped" | "error";

export type StageState = {
  id: StageId;
  label: string;
  status: StageStatus;
  message: string | null;
};

export type StageEvent = {
  stage: StageId;
  status: "start" | "done" | "skipped" | "error";
  message?: string;
};
