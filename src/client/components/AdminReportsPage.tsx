import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { adminRequest } from "../adminApi";
import { Alert, Box, Button, Chip, CircularProgress, MenuItem, Pagination, Paper, Stack, TextField, Typography } from "@mui/material";
import { RefreshRounded } from "@mui/icons-material";
import { ISSUE_STATUS_LABELS, SCREEN_LABELS } from "../utils/issueReportsApi";
import type { IssueReport, IssueStatus } from "../utils/issueReportsApi";
import { IssueReportScreenshot } from "./IssueReportScreenshot";

export function AdminReportsPage({ reloadKey }: { reloadKey: number }) {
  const { user } = useAuth();
  const [reports, setReports] = useState<IssueReport[]>([]);
  const [status, setStatus] = useState<IssueStatus | "">("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    if (!user) { setReports([]); setLoading(false); return; }
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("status", status);
      const data = await adminRequest<{ reports: IssueReport[]; total: number }>(user, `/issue-reports?${params}`);
      if (!Array.isArray(data.reports) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error("התקבלה תשובה לא תקינה. נסו שוב.");
      if (version !== requestVersion.current) return;
      // A status change can remove the last item on a filtered page.
      const lastPage = Math.max(1, Math.ceil(data.total / 50));
      if (page > lastPage) { setPage(lastPage); return; }
      setReports(data.reports);
      setTotal(data.total);
    } catch (err) {
      if (version === requestVersion.current) {
        setReports([]);
        setError(err instanceof Error ? err.message : "טעינת הדיווחים נכשלה.");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [user, page, status, reloadKey]);

  useEffect(() => {
    void load();
    return () => { requestVersion.current++; };
  }, [load]);

  const updateStatus = async (id: number, nextStatus: IssueStatus) => {
    if (!user) return;
    setSaving(id);
    setError(null);
    try {
      await adminRequest(user, `/issue-reports/${id}/status`, { status: nextStatus });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "עדכון הסטטוס נכשל.");
    } finally { setSaving(null); }
  };

  return (
    <Box role="tabpanel" id="admin-reports-panel" aria-labelledby="admin-reports-tab" dir="rtl" sx={{ maxWidth: 1000, mx: "auto" }}>
      <Stack spacing={3}>
        <Box><Typography variant="h4" component="h1">ניהול דיווחי תקלות</Typography><Typography color="text.secondary">דיווחים מהמשתמשים ומעקב אחר הטיפול בהם</Typography></Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <TextField select label="סטטוס" value={status} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} onChange={(event) => { setStatus(event.target.value as IssueStatus | ""); setPage(1); }} disabled={saving !== null} sx={{ minWidth: 180 }} size="small">
            <MenuItem value="">כל הדיווחים</MenuItem>
            {Object.entries(ISSUE_STATUS_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <Button startIcon={<RefreshRounded />} onClick={() => void load()} disabled={loading || saving !== null}>רענון</Button>
          <Typography color="text.secondary">{total.toLocaleString("he-IL")} דיווחים</Typography>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        {loading ? <Box sx={{ textAlign: "center", py: 4 }}><CircularProgress aria-label="טוען דיווחים" /></Box> : (
          <>
            {!error && reports.length === 0 && <Alert severity="info">{status ? "אין דיווחים בסטטוס שנבחר." : "עדיין לא התקבלו דיווחים."}</Alert>}
            {reports.map((report) => (
              <Paper key={report.id} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography component="h2" variant="h6" sx={{ flexGrow: 1, overflowWrap: "anywhere" }}>#{report.id} · {report.title}</Typography>
                    <Chip label={ISSUE_STATUS_LABELS[report.status]} color={report.status === "resolved" ? "success" : report.status === "in_progress" ? "warning" : "info"} size="small" />
                  </Stack>
                  <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>{report.user_display_name || "משתמש"} · {report.user_email || report.user_uid}</Typography>
                  <Typography variant="body2" color="text.secondary">{new Date(report.created_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })} · {SCREEN_LABELS[report.screen] || report.screen}</Typography>
                  <Typography sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{report.description}</Typography>
                  {Boolean(report.has_screenshot) && user && <IssueReportScreenshot user={user} reportId={report.id} />}
                  <TextField select size="small" label="סטטוס טיפול" value={report.status} disabled={saving !== null} onChange={(event) => void updateStatus(report.id, event.target.value as IssueStatus)} sx={{ width: 180 }}>
                    {Object.entries(ISSUE_STATUS_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                  </TextField>
                  {saving === report.id && <Typography role="status" variant="body2">שומר...</Typography>}
                </Stack>
              </Paper>
            ))}
            {total > 50 && <Pagination count={Math.ceil(total / 50)} page={page} disabled={saving !== null} onChange={(_, value) => setPage(value)} aria-label="עמודי דיווחים" />}
          </>
        )}
      </Stack>
    </Box>
  );
}
