import { useEffect, useRef, useState } from "react";
import { Button, useMediaQuery } from "@mui/material";
import { ArrowBackRounded, AutoAwesomeRounded, CheckRounded, PauseRounded, PlayArrowRounded, UploadFileRounded, TuneRounded, DownloadRounded } from "@mui/icons-material";
import "./PromotionalHome.css";

interface PromotionalHomeProps {
  authLoading: boolean;
  onSignIn: () => Promise<void>;
  isAuthenticated: boolean;
  onStart: () => void;
}
const styles = [
  { id: "active", name: "מילה פעילה", note: "כל מילה מקבלת את הרגע שלה" },
  { id: "clean", name: "נקי וקלאסי", note: "קריא, פשוט ומדויק" },
  { id: "bold", name: "בולט בסושיאל", note: "נותנים לטקסט את הבמה" },
] as const;
const lines = [["כל", "סרטון", "מתחיל", "בסיפור."], ["תנו", "למילים", "שלכם", "מקום."]];
const faqs = [
  ["אפשר לערוך את הכתוביות אחרי התמלול?", "כן. אפשר לתקן את הטקסט, לשנות את התזמון ולבחור את העיצוב לפני ההורדה."],
  ["מה אפשר להוריד בסיום?", "אפשר להוריד קובץ כתוביות ב־SRT או VTT, או סרטון עם הכתוביות מוטמעות בתוכו."],
  ["אפשר לתמלל גם קובץ אודיו?", "כן. ניתן להעלות גם קובץ אודיו, לערוך את התמלול ולהוריד קובץ כתוביות."],
  ["איך התשלום עובד?", "התמלול משתמש בקרדיטים. לפני העיבוד מוצגת הערכת העלות לפי הקובץ והמודל שנבחר. ניתן לרכוש חבילות קרדיטים מתוך החשבון."],
];

export function PromotionalHome({ authLoading, onSignIn, isAuthenticated, onStart }: PromotionalHomeProps) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [style, setStyle] = useState<(typeof styles)[number]["id"]>("active");
  const demo = useRef<HTMLElement>(null);
  const start = isAuthenticated ? onStart : onSignIn;
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setTick(value => (value + 1) % 8), 650);
    return () => window.clearInterval(timer);
  }, [playing]);
  const watchDemo = () => {
    setPlaying(true);
    demo.current?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
    demo.current?.focus({ preventScroll: true });
  };
  return (
    <main className="marketing" dir="rtl">
      <div className="marketing-wrap">
        <nav className="marketing-nav" aria-label="ניווט בעמוד השיווקי">{[["caption-demo", "דוגמת כתוביות"], ["how-it-works", "איך זה עובד"], ["marketing-faq", "שאלות נפוצות"]].map(([id, label]) => <a key={id} href={`#${id}`} onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); scrollTo(id); }}>{label}</a>)}</nav>
        <section className="marketing-hero" aria-labelledby="marketing-title">
          <div className="marketing-copy">
            <span className="marketing-eyebrow"><AutoAwesomeRounded fontSize="small" /> נוצר בשביל המילים שלכם</span>
            <h1 id="marketing-title">הסרטון שלכם.<br />כתוביות בעברית.<br /><span>הסגנון שלכם.</span></h1>
            <p className="marketing-intro">תמלול אוטומטי, עריכה ועיצוב —<br className="marketing-desktop-break" /> עד לסרטון מוכן לשיתוף.</p>
            <div className="marketing-actions"><Button className="marketing-primary" variant="contained" onClick={start} disabled={authLoading} endIcon={<ArrowBackRounded />}>{authLoading ? "טוענים..." : "התחילו ליצור כתוביות"}</Button><Button className="marketing-watch" onClick={watchDemo} startIcon={<PlayArrowRounded />}>צפו בדוגמה</Button></div>
            <p className="marketing-action-note">{isAuthenticated ? "מוכנים? אפשר להתחיל עם סרטון או אודיו." : "מתחברים ומתחילים. הכול ישירות בדפדפן."}</p>
            <div className="marketing-benefits">{["עריכה בעברית", "עיצוב בשליטה שלכם", "הורדת סרטון או כתוביות"].map(item => <span key={item}><CheckRounded />{item}</span>)}</div>
          </div>
          <section id="caption-demo" className="marketing-demo" ref={demo} tabIndex={-1} aria-label="הדגמת סגנונות כתוביות">
            <div className="marketing-demo-top"><span><span className="marketing-live-dot" /> תצוגה מקדימה</span><span className="marketing-demo-label">הדגמת עיצוב</span></div>
            <div className="marketing-demo-body">
              <div className="marketing-preview">
                <img src="/demo/creator.webp" alt="תמונת יוצר להדגמת עיצוב הכתוביות" width="1024" height="1536" fetchPriority="high" />
                <span className="marketing-preview-tag">כתוביות בעברית</span>
                <div className={`marketing-caption marketing-caption-${style}`} data-testid="marketing-caption" aria-label="דוגמת כתוביות">{lines[Math.floor(tick / 4)].map((word, index) => <span key={`${Math.floor(tick / 4)}-${index}`} className={index === tick % 4 ? "is-active" : undefined}>{word}</span>)}</div>
                <div className="marketing-preview-bottom"><span>הסיפור שלכם, בפריים.</span><span dir="ltr">QUICK / CAPTION</span></div>
              </div>
              <div className="marketing-style-picker" role="group" aria-label="בחירת סגנון הדגמה">
                <span className="marketing-style-heading"><TuneRounded /> הסגנון שלכם</span>
                {styles.map(item => <button key={item.id} className={`marketing-style-option ${item.id === style ? "is-selected" : ""}`} aria-pressed={item.id === style} onClick={() => setStyle(item.id)}><span className={`marketing-style-sample marketing-style-sample-${item.id}`}>Aa</span><span>{item.name}</span></button>)}
                <div className="marketing-demo-tip"><AutoAwesomeRounded /> בחרו סגנון.<br />ראו את ההבדל.</div>
              </div>
            </div>
            <div className="marketing-demo-controls"><button aria-label={playing ? "השהיית הדגמה" : "הפעלת הדגמה"} onClick={() => setPlaying(value => !value)}>{playing ? <PauseRounded /> : <PlayArrowRounded />}</button><div className="marketing-demo-progress" aria-hidden="true"><span style={{ width: `${(tick + 1) * 12.5}%` }} /></div><span className="marketing-demo-time" dir="ltr">0:0{Math.floor(tick * .65)} / 0:05</span></div>
            <p className="marketing-demo-note">{styles.find(item => item.id === style)?.note}</p>
          </section>
        </section>
        <div className="marketing-use-cases"><span>לכל תוכן שיש לכם לומר</span><div><span>רילס וסטוריז</span><i /><span>פודקאסטים</span><i /><span>סרטוני הדרכה</span><i /><span>תוכן לעסק</span></div></div>
        <section id="how-it-works" className="marketing-process" aria-labelledby="marketing-process-title">
          <div className="marketing-section-title"><span className="marketing-kicker">פחות התעסקות. יותר יצירה.</span><h2 id="marketing-process-title">מהסרטון שלכם, לתוצאה שלכם.</h2><p>שלושה שלבים, והשליטה נשארת אצלכם.</p></div>
          <div className="marketing-steps">
            <article><div className="marketing-step-icon"><UploadFileRounded /><span>01</span></div><h3>מעלים</h3><p>בוחרים סרטון או קובץ אודיו.<br />התמלול האוטומטי נותן לכם נקודת פתיחה.</p><div className="marketing-step-detail">סרטון או אודיו <span>↑</span></div></article>
            <article><div className="marketing-step-icon"><TuneRounded /><span>02</span></div><h3>נותנים את הטאץ׳ שלכם</h3><p>מתקנים מילים, מדייקים את התזמון ובוחרים פונט, צבע וסגנון.</p><div className="marketing-step-detail marketing-word-detail">הסגנון <mark>שלכם.</mark></div></article>
            <article><div className="marketing-step-icon"><DownloadRounded /><span>03</span></div><h3>מוכנים לשיתוף</h3><p>מורידים סרטון עם כתוביות מוטמעות, או קובץ כתוביות לשימוש נוסף.</p><div className="marketing-step-detail marketing-formats"><span>VIDEO</span><span>SRT</span><span>VTT</span></div></article>
          </div>
        </section>
        <section id="marketing-faq" className="marketing-faq" aria-labelledby="marketing-faq-title"><div><span className="marketing-kicker">טוב לדעת</span><h2 id="marketing-faq-title">לפני שמתחילים.</h2><p>כמה תשובות קצרות,<br />כדי שתוכלו להתמקד ביצירה.</p></div><div className="marketing-questions">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
        <section className="marketing-final"><span className="marketing-kicker">המילים כבר אצלכם.</span><h2>עכשיו תנו להן מקום בסרטון.</h2><Button className="marketing-primary" variant="contained" onClick={start} disabled={authLoading} endIcon={<ArrowBackRounded />}>לסרטון הבא שלכם</Button><p>עברית. עיצוב. הסיפור שלכם.</p></section>
        <footer className="marketing-footer"><img src="/quickcaption-logo.svg" width="165" height="36" alt="Quick Caption" /><span>כתוביות בעברית, בדרך שלכם.</span><a href="#marketing-title" onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); scrollTo("marketing-title"); }}>בחזרה למעלה ↑</a></footer>
      </div>
    </main>
  );
}
