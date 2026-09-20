import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Slider, Snackbar, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { AddRounded, EditOutlined, MyLocationRounded, DeleteOutlineRounded, ZoomInRounded, ShortTextRounded } from "@mui/icons-material";
import { Timeline, type TimelineRow, type TimelineState } from "@xzdarcy/react-timeline-editor";
import type { Segment, Word } from "../types";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { formatTimecode, snapToFrame } from "../utils/timecode";
import { validateWordRange } from "../../timelineEditing.js";
import { TimecodeField } from "./TimecodeField";
import { TimelineEditToolbar } from "./TimelineEditToolbar";

// Drafts belong to the parent so switching captions never discards work.
export function WordTimeline({ enabled, segment, words, currentTime, onWordsChange, onSeek, disabled, toolbarEditor, toolbarActions, toolbarPrimary, toolbarClose }: {
  enabled: boolean;
  segment: Segment; words: Word[]; currentTime: number;
  onWordsChange: (words: Word[]) => void; onSeek: (time: number) => void; disabled?: boolean;
  toolbarEditor: ReactNode; toolbarActions: ReactNode; toolbarPrimary: ReactNode; toolbarClose: ReactNode;
}) {
  const { preferences } = useEditorPreferences();
  const fps = preferences.fps;
  const [zoom, setZoom] = useState(160);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ index: number | null; word: Word } | null>(null);
  const [validStart, setValidStart] = useState(true), [validEnd, setValidEnd] = useState(true);
  const timeline = useRef<TimelineState | null>(null);
  const duration = segment.end - segment.start;
  useEffect(() => { setSelected(null); setEditing(null); setError(null); }, [segment.id, enabled]);
  useLayoutEffect(() => {
    const time = Math.max(0, Math.min(duration, currentTime - segment.start));
    if (timeline.current?.getTime() !== time) timeline.current?.setTime(time);
  }, [currentTime, segment.start, duration, zoom, enabled]);
  const rows = useMemo<TimelineRow[]>(() => [{ id: "words", actions: words.map((word, i) => ({
    id: String(i), effectId: String(i), start: word.start - segment.start, end: word.end - segment.start,
    movable: !disabled, flexible: !disabled,
  })) }], [words, segment.start, disabled]);
  const effects = useMemo(() => Object.fromEntries(words.map((w, i) => [String(i), { id: String(i), name: w.word }])), [words]);
  const seek = (relative: number) => { onSeek(Math.min(segment.end, Math.max(segment.start, snapToFrame(segment.start + relative, fps)))); return true; };
  const update = (next: Word[]) => { setError(null); onWordsChange(next.map((w, wordIndex) => ({ ...w, segmentId: segment.id, wordIndex }))); };
  const dialogError = editing && (validateWordRange(editing.word, segment, words.filter((_, i) => i !== editing.index)) ||
    (editing.index !== null && ((editing.index > 0 && editing.word.start < words[editing.index - 1].start) ||
      (editing.index < words.length - 1 && editing.word.start > words[editing.index + 1].start))
      ? "שינוי תזמון לא משנה את סדר המילים. ערכו את הטקסט כדי לשנות סדר." : null));
  const openAdd = () => {
    let start = segment.start;
    for (const word of words) { if (word.start - start >= 1 / fps) break; start = Math.max(start, word.end); }
    const nextStart = words.find(w => w.start > start + .000001)?.start ?? segment.end;
    setValidStart(true); setValidEnd(true);
    setEditing({ index: null, word: { word: "", start, end: Math.min(nextStart, start + .5), segmentId: segment.id, timingSource: "aligned" } });
  };
  // Only the presentation changes. The caption draft and its word timing data
  // remain owned by the parent, including when highlighting is switched off.
  if (!enabled) return <TimelineEditToolbar editor={toolbarEditor} actions={toolbarActions}
    primary={toolbarPrimary} close={toolbarClose} compactAt={600} label="עריכת המקטע" actionsLabel="פעולות מקטע" />;
  const hasWord = selected !== null && !!words[selected];
  return <Box data-testid="word-editor">
    <TimelineEditToolbar editor={toolbarEditor} primary={toolbarPrimary} close={toolbarClose} actions={<>
      {toolbarActions}
      <Box className="timeline-toolbar-divider" />
      <Tooltip title="ציר פנימי — מילים במקטע הנבחר. גררו מילה להזזה ואת הקצוות לשינוי משך."><Box component="span" sx={{ display: "flex", alignItems: "center", color: "text.secondary", gap: .25 }}><ShortTextRounded fontSize="small" /><Typography variant="caption">מילים</Typography></Box></Tooltip>
      <Tooltip title="הוסף מילה"><span><IconButton size="small" aria-label="הוסף מילה" disabled={disabled} onClick={openAdd}><AddRounded /></IconButton></span></Tooltip>
      <Tooltip title={hasWord ? "ערוך מילה ותזמון" : "בחרו מילה בציר לעריכה"}><span><IconButton size="small" aria-label="ערוך מילה ותזמון" disabled={disabled || !hasWord} onClick={() => { if (selected === null) return; setValidStart(true); setValidEnd(true); setEditing({ index: selected, word: { ...words[selected] } }); }}><EditOutlined /></IconButton></span></Tooltip>
      <Tooltip title="עבור למיקום המילה"><span><IconButton size="small" aria-label="עבור למיקום המילה" disabled={!hasWord} onClick={() => { if (selected !== null) onSeek(words[selected].start); }}><MyLocationRounded /></IconButton></span></Tooltip>
      <Tooltip title="הסר מילה מהטיוטה"><span><IconButton size="small" aria-label="הסר מילה מהטיוטה" color="error" disabled={disabled || !hasWord} onClick={() => { update(words.filter((_, i) => i !== selected)); setSelected(null); }}><DeleteOutlineRounded /></IconButton></span></Tooltip>
      <Box className="timeline-toolbar-divider" />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: 110, px: 1 }}>
        <Tooltip title="זום מילים"><ZoomInRounded fontSize="small" color="action" /></Tooltip>
        <Slider size="small" aria-label="זום מילים" min={80} max={640} value={zoom} onChange={(_, v) => setZoom(v as number)} />
      </Box>
    </>} />
    <Snackbar open={!!error} onClose={() => setError(null)}><Alert severity="warning" onClose={() => setError(null)}>{error}</Alert></Snackbar>
    <Box data-testid="word-track" aria-label="ציר פנימי — מילים במקטע הנבחר" sx={{ direction: "ltr", "& *": { direction: "ltr !important" }, minWidth: 0 }}>
      <Timeline ref={timeline} editorData={rows} effects={effects} scale={1} scaleWidth={zoom} minScaleCount={Math.max(2, Math.ceil(duration) + 1)}
        gridSnap={false} dragLine disableDrag={disabled}
        onCursorDrag={seek} onCursorDragEnd={seek} onClickTimeArea={seek}
        onChange={nextRows => {
          const next = (nextRows[0]?.actions ?? []).map(a => {
            const original = words[Number(a.id)];
            if (!original) return null;
            const start = a.start + segment.start, end = a.end + segment.start;
            if (Math.abs(start - original.start) < .000001 && Math.abs(end - original.end) < .000001) return original;
            return { ...original, start: Math.abs(start - original.start) < .000001 ? original.start : snapToFrame(start, fps), end: Math.abs(end - original.end) < .000001 ? original.end : snapToFrame(end, fps), timingSource: "aligned" as const };
          }).filter((word): word is Word => word !== null);
          if (next.length !== words.length) return false;
          for (let i = 0; i < next.length; i++) {
            if (next[i].start === words[i].start && next[i].end === words[i].end) continue;
            const problem = validateWordRange(next[i], segment, next.filter((_, j) => i !== j));
            if (problem || (i > 0 && next[i].start < next[i - 1].start) || (i < next.length - 1 && next[i].start > next[i + 1].start)) {
              setError(problem || "שינוי תזמון לא משנה את סדר המילים. ערכו את הטקסט כדי לשנות סדר."); return false;
            }
          }
          update(next);
        }}
        getScaleRender={value => <span>{formatTimecode(value, fps)}</span>}
        getActionRender={action => <Box className="word-timeline-action" data-testid="word-clip" role="button" tabIndex={0}
          aria-label={`עריכת מילה: ${words[Number(action.id)]?.word}`} aria-pressed={selected === Number(action.id)}
          title={`${words[Number(action.id)]?.word} · ${formatTimecode(segment.start + action.start, fps)} – ${formatTimecode(segment.start + action.end, fps)}`}
          onClick={() => setSelected(Number(action.id))} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(Number(action.id)); } }}
          sx={{ bgcolor: selected === Number(action.id) ? "primary.main" : "success.dark", height: "100%", color: "white", borderRadius: 1, px: 1, display: "flex", alignItems: "center", overflow: "hidden" }}>
          <Typography noWrap variant="caption" sx={{ direction: `${preferences.direction} !important`, unicodeBidi: "plaintext" }}>{words[Number(action.id)]?.word}</Typography>
        </Box>} style={{ width: "100%", height: 120 }} />
    </Box>
    <Dialog open={!!editing} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
      <DialogTitle>{editing?.index === null ? "הוסף מילה חדשה" : "עריכת מילה ותזמון"}</DialogTitle>
      {editing && <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <TextField autoFocus label="טקסט המילה" value={editing.word.word} onChange={e => setEditing({ ...editing, word: { ...editing.word, word: e.target.value } })} />
        <Typography variant="caption">גבולות המקטע: <span dir="ltr">{formatTimecode(segment.start, fps)} – {formatTimecode(segment.end, fps)}</span></Typography>
        <TimecodeField label="תחילת המילה" value={editing.word.start} fps={fps} onValidityChange={setValidStart} onChange={start => setEditing({ ...editing, word: { ...editing.word, start } })} />
        <TimecodeField label="סיום המילה" value={editing.word.end} fps={fps} onValidityChange={setValidEnd} onChange={end => setEditing({ ...editing, word: { ...editing.word, end } })} />
        {dialogError && <Alert severity="warning">{dialogError}</Alert>}
      </Stack></DialogContent>}
      <DialogActions>
        <Button onClick={() => setEditing(null)}>ביטול</Button>
        <Button disabled={!!dialogError || !validStart || !validEnd || disabled} onClick={() => {
          if (!editing || dialogError) return;
          const next = words.filter((_, i) => i !== editing.index);
          next.push({ ...editing.word, word: editing.word.word.trim(), timingSource: "aligned" });
          update(next.sort((a, b) => a.start - b.start)); setSelected(null); setEditing(null);
        }}>החל בטיוטה</Button>
      </DialogActions>
    </Dialog>
  </Box>;
}
