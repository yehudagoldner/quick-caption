export const transcribeMedia = async () => { throw new Error('Provider calls disabled in audit server'); };
export const normalizeSubtitleFormat = format => format;
export const transcribeWithWordTimestamps = transcribeMedia;
export const getMediaDuration = async () => 5;
export const resegmentWithGPT = transcribeMedia;
export const intelligentSplitSegment = transcribeMedia;
export const aiEditSubtitles = transcribeMedia;
