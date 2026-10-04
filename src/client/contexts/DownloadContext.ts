import { createContext } from 'react';

export type DownloadFile = { url: string; name: string };
export function startFileDownload({ url, name }: DownloadFile) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
const download = async (file: DownloadFile) => { startFileDownload(file); return true; };
export const DownloadContext = createContext({ downloadSubtitles: download, downloadVideo: download });
