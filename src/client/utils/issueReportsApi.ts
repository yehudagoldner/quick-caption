import type { User } from "firebase/auth";

const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "").replace(/\/$/, "");

export async function issueReportsApi<T>(user: User, path = "", options: RequestInit = {}): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE}/api/issue-reports${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "הבקשה נכשלה. נסו שוב.");
  return data as T;
}

export type IssueStatus = "open" | "in_progress" | "resolved";
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "חדש", in_progress: "בטיפול", resolved: "טופל",
};
export const SCREEN_LABELS: Record<string, string> = {
  home: "דף הבית", transcription: "יצירת כתוביות", videos: "הווידאו שלי", edit: "עריכת סרטון", admin: "ממשק ניהול", "buy-credits": "רכישת קרדיטים",
};

export type IssueReport = {
  id: number;
  user_uid: string;
  user_email: string | null;
  user_display_name: string | null;
  title: string;
  description: string;
  screen: string;
  status: IssueStatus;
  created_at: string;
  updated_at: string;
  has_screenshot?: boolean | number;
};
