import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent } from "react";
import type { User } from "firebase/auth";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { AddPhotoAlternateOutlined } from "@mui/icons-material";
import { issueReportsApi } from "../utils/issueReportsApi";

type Props = { user: User; screen: string; onClose: () => void };

export function IssueReportDialog({ user, screen, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<number | null>(null);
  const [screenshot, setScreenshot] = useState<{ dataUrl: string; mimeType: string; name: string } | null>(null);
  const [readingImage, setReadingImage] = useState(false);
  const imageVersion = useRef(0);
  useEffect(() => () => { imageVersion.current++; }, []);

  const attachScreenshot = async (file: File) => {
    const mimeType = file.type || (/\.png$/i.test(file.name) ? "image/png" : /\.jpe?g$/i.test(file.name) ? "image/jpeg" : /\.webp$/i.test(file.name) ? "image/webp" : "");
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType) || file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError("יש לבחור תמונת PNG, JPG או WebP בגודל עד 5 MB."); return;
    }
    const version = ++imageVersion.current;
    setReadingImage(true); setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("לא ניתן לקרוא את צילום המסך. נסו לבחור אותו שוב."));
        reader.readAsDataURL(file);
      });
      if (version === imageVersion.current) setScreenshot({ dataUrl, mimeType, name: file.name || "צילום מסך" });
    } catch (err) {
      if (version === imageVersion.current) setError((err as Error).message);
    } finally { if (version === imageVersion.current) setReadingImage(false); }
  };

  const pasteScreenshot = (event: ClipboardEvent) => {
    if (submitting || reportId !== null) return;
    const image = Array.from(event.clipboardData.items).find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
    if (image) { event.preventDefault(); void attachScreenshot(image); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || readingImage || !title.trim() || !description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await issueReportsApi<{ reportId: number }>(user, "", {
        method: "POST", body: JSON.stringify({ title: title.trim(), description: description.trim(), screen,
          screenshot: screenshot ? { data: screenshot.dataUrl.slice(screenshot.dataUrl.indexOf(",") + 1), mimeType: screenshot.mimeType } : null }),
      });
      if (!Number.isSafeInteger(result?.reportId) || result.reportId < 1) throw new Error("לא התקבל אישור שליחה תקין. נסו שוב.");
      setReportId(result.reportId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שליחת הדיווח נכשלה. נסו שוב.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={submitting || readingImage ? undefined : onClose} onPaste={pasteScreenshot} fullWidth maxWidth="sm" dir="rtl" aria-labelledby="issue-report-title">
      <form onSubmit={submit}>
        <DialogTitle id="issue-report-title">דיווח על תקלה</DialogTitle>
        <DialogContent>
          {reportId !== null ? (
            <Alert severity="success" role="status">הדיווח נשלח בהצלחה לצוות. מספר הדיווח: {reportId}</Alert>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography color="text.secondary">תארו מה קרה ומה ציפיתם שיקרה. פרטי החשבון והמסך הנוכחי יצורפו לדיווח.</Typography>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField autoFocus required label="נושא התקלה" value={title} onChange={(event) => setTitle(event.target.value)} disabled={submitting} inputProps={{ maxLength: 200 }} fullWidth />
              <TextField required label="תיאור התקלה" placeholder="מה ניסיתם לעשות? באיזה שלב הופיעה התקלה?" value={description} onChange={(event) => setDescription(event.target.value)} disabled={submitting} multiline minRows={5} inputProps={{ maxLength: 5000 }} helperText={`${description.length.toLocaleString("he-IL")} / 5,000`} fullWidth />
              <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 2, p: 2 }}>
                <Stack spacing={1.5}>
                  <Typography fontWeight={600}>צילום מסך (אופציונלי)</Typography>
                  <Typography variant="body2" color="text.secondary">העלו תמונה או הדביקו צילום מסך עם Ctrl+V.</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button component="label" variant="outlined" startIcon={<AddPhotoAlternateOutlined />} disabled={submitting || readingImage}>
                      העלאת צילום מסך
                      <input aria-label="בחירת צילום מסך" type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={submitting || readingImage} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void attachScreenshot(file); }} />
                    </Button>
                    {screenshot && <Button onClick={() => { imageVersion.current++; setScreenshot(null); setError(null); }} disabled={submitting || readingImage}>הסרת צילום</Button>}
                  </Stack>
                  {readingImage && <Typography role="status" variant="body2">מכין צילום מסך...</Typography>}
                  {screenshot && <><Box component="img" src={screenshot.dataUrl} alt="תצוגה מקדימה של צילום המסך" sx={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 1 }} /><Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>{screenshot.name}</Typography></>}
                </Stack>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting || readingImage}>{reportId !== null ? "סגירה" : "ביטול"}</Button>
          {reportId === null && <Button type="submit" variant="contained" disabled={submitting || readingImage || !title.trim() || !description.trim()} startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : undefined}>{submitting ? "שולח..." : "שליחת דיווח"}</Button>}
        </DialogActions>
      </form>
    </Dialog>
  );
}
