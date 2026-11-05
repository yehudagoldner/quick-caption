export type ExportSettings = { mode: 'quality' | 'bitrate'; quality: 'high' | 'balanced' | 'compact'; bitrateMbps: number; resolution?: 'source' | 2160 | 1440 | 1080 | 720 | 480 | 360 };
export const DEFAULT_EXPORT_SETTINGS: Readonly<ExportSettings>;
export const EXPORT_QUALITIES: Readonly<Record<ExportSettings['quality'], number>>;
export const MIN_EXPORT_BITRATE: number;
export const MAX_EXPORT_BITRATE: number;
export function validateExportSettings(value?: unknown): ExportSettings;
export function sanitizeExportSettings(value: unknown): ExportSettings;
export function exportEncodeArguments(settings?: ExportSettings): string[];
export function estimateExportSize(settings: ExportSettings, duration: number | null, dimensions?: { width: number; height: number } | null): { bytes: number; minBytes: number; maxBytes: number } | null;

export const EXPORT_RESOLUTIONS: number[];
export function availableExportResolutions(dimensions?: { width: number; height: number } | null): number[];
export function exportDimensions(settings: ExportSettings, dimensions?: { width: number; height: number } | null): { width: number; height: number } | null;
export function exportScaleFilter(settings?: ExportSettings): string;
export function estimatedVideoBitrate(settings: ExportSettings, dimensions?: { width: number; height: number } | null): number;
