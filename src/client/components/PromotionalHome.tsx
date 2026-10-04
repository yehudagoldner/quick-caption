import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { Button, useMediaQuery } from "@mui/material";
import {
  ArrowBackRounded, AutoAwesomeRounded, AutoFixHighRounded, CheckRounded, DownloadRounded, FormatTextdirectionRToLRounded,
  MovieFilterRounded, PhoneIphoneRounded, PlayArrowRounded, RecordVoiceOverRounded, SubtitlesRounded, TimelineRounded,
  TuneRounded, UploadFileRounded, VerifiedRounded, VideoLibraryRounded,
} from "@mui/icons-material";
import { DesktopEditorDemo, PhoneEditorDemo, CaptionOverlay } from "./marketing/EditorDemo";
import { DEMO_IMAGE, LOOK_PRESETS, sameLook, useCaptionDemo, useElementSize, useInView, type CaptionDemo, type CaptionLook } from "./marketing/captionDemo";
import { findSegment } from "../utils/transcriptionUtils";
import "./PromotionalHome.css";

interface PromotionalHomeProps {
  authLoading: boolean;
  onSignIn: () => Promise<void>;
  isAuthenticated: boolean;
  onStart: () => void;
  onMyVideos?: () => void;
}

const useCases = ["רילס וטיקטוק", "פודקאסטים", "יוטיוב שורטס", "סרטוני הדרכה", "הרצאות ווובינרים", "מודעות ותוכן לעסק", "ראיונות", "וולוגים"];
const faqs = [
  ["אפשר לערוך את הכתוביות אחרי התמלול?", "כן. אפשר לתקן את הטקסט, לשנות את התזמון בציר הזמן, לפצל ולחבר כתוביות ולבחור את העיצוב לפני ההורדה."],
  ["מה אפשר להוריד בסיום?", "קובץ כתוביות ב־SRT, VTT או TXT, או סרטון עם הכתוביות צרובות בתוכו."],
  ["הסרטון הצרוב ייראה כמו בתצוגה המקדימה?", "כן. התצוגה המקדימה משתמשת באותו פונט ובאותם חישובי גודל ומיקום שבהם הכתוביות נצרבות לסרטון."],
  ["אפשר לתמלל גם קובץ אודיו?", "כן. ניתן להעלות גם קובץ אודיו, לערוך את התמלול ולהוריד קובץ כתוביות."],
  ["איזה גודל קובץ אפשר להעלות, וכמה זמן הוא נשמר?", "עד 500MB לקובץ. סרטונים והכתוביות שלהם נמחקים לאחר 30 יום ללא פתיחה או עריכה."],
  ["איך התשלום עובד?", "התמלול משתמש בקרדיטים. לפני העיבוד מוצגת הערכת העלות לפי הקובץ והמודל שנבחר. ניתן לרכוש חבילות קרדיטים מתוך החשבון."],
];
const sections = [["caption-demo", "הדגמה"], ["styles", "סגנונות"], ["how-it-works", "איך זה עובד"], ["features", "יכולות"], ["marketing-faq", "שאלות נפוצות"]];

function LookCard({ name, note, look, demo, selected, onApply }: { name: string; note: string; look: CaptionLook; demo: CaptionDemo; selected: boolean; onApply: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const size = useElementSize(frame);
  const segment = findSegment(demo.segments, demo.time) ?? null;
  return <article className={`marketing-look ${selected ? "is-selected" : ""}`}>
    <div className="marketing-look-frame" ref={frame}>
      <img src={DEMO_IMAGE} alt="" width="1024" height="1536" loading="lazy" />
      <CaptionOverlay look={look} segments={demo.segments} segment={segment} time={demo.time} render={size} />
    </div>
    <div className="marketing-look-meta">
      <div><h3>{name}</h3><p>{note}</p></div>
      <span className="marketing-look-swatches" aria-hidden="true"><i style={{ background: look.fontColor }} /><i style={{ background: look.outlineColor }} /></span>
    </div>
    <button type="button" className="marketing-look-apply" aria-pressed={selected} aria-label={`${name}: נסו בעורך`} onClick={onApply}>
      {selected ? <><CheckRounded /> פעיל בהדגמה</> : <>נסו בעורך <ArrowBackRounded /></>}
    </button>
  </article>;
}

function useCarouselIndex(ref: RefObject<HTMLElement | null>) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = element.getBoundingClientRect();
        const center = box.left + box.width / 2;
        let nearest = 0;
        let distance = Infinity;
        Array.from(element.children).forEach((child, position) => {
          const rect = child.getBoundingClientRect();
          const offset = Math.abs(rect.left + rect.width / 2 - center);
          if (offset < distance) { distance = offset; nearest = position; }
        });
        setIndex(nearest);
      });
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    return () => { element.removeEventListener("scroll", update); cancelAnimationFrame(frame); };
  }, [ref]);
  return index;
}

function CarouselDots({ target, count, label, behavior }: { target: RefObject<HTMLElement | null>; count: number; label: string; behavior: ScrollBehavior }) {
  const index = useCarouselIndex(target);
  const go = (position: number) => (target.current?.children[position] as HTMLElement | undefined)?.scrollIntoView({ behavior, inline: "center", block: "nearest" });
  return <div className="marketing-dots" role="group" aria-label={label}>
    {Array.from({ length: count }, (_, position) => <button key={position} type="button" className={position === index ? "is-active" : undefined}
      aria-label={`${position + 1} מתוך ${count}`} aria-current={position === index || undefined} onClick={() => go(position)} />)}
  </div>;
}

export function PromotionalHome({ authLoading, onSignIn, isAuthenticated, onStart, onMyVideos }: PromotionalHomeProps) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", { noSsr: true });
  const wide = useMediaQuery("(min-width: 760px)", { noSsr: true });
  const demoRef = useRef<HTMLElement>(null);
  const stylesRef = useRef<HTMLElement>(null);
  const featuresRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const finalRef = useRef<HTMLElement>(null);
  const looksRef = useRef<HTMLDivElement>(null);
  const bentoRef = useRef<HTMLDivElement>(null);
  const demo = useCaptionDemo({ autoplay: !reducedMotion, visible: useInView(demoRef) });
  const stylesVisible = useInView(stylesRef);
  const featuresVisible = useInView(featuresRef);
  const gallery = useCaptionDemo({ autoplay: !reducedMotion, visible: stylesVisible || featuresVisible });
  const heroActionsVisible = useInView(actionsRef, 0, true);
  const finalVisible = useInView(finalRef);
  const dockVisible = isAuthenticated || (!heroActionsVisible && !finalVisible);
  const start = useCallback(() => { if (isAuthenticated) onStart(); else void onSignIn(); }, [isAuthenticated, onStart, onSignIn]);
  const behavior: ScrollBehavior = reducedMotion ? "instant" : "smooth";
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
  const jump = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    scrollTo(id);
  };
  const showDemo = () => {
    demo.setPlaying(true);
    demoRef.current?.scrollIntoView({ behavior, block: "center" });
    demoRef.current?.focus({ preventScroll: true });
  };
  const applyLook = (look: CaptionLook) => {
    demo.setLook(look);
    demo.setPlaying(true);
    showDemo();
  };

  return (
    <main className={`marketing ${wide ? "" : "has-dock"}`} dir="rtl">
      <section className="marketing-hero" aria-labelledby="marketing-title">
        <div className="marketing-aurora" aria-hidden="true"><i /><i /><i /></div>
        <div className="marketing-wrap">
          <nav className="marketing-nav" aria-label="ניווט בעמוד השיווקי">
            {sections.map(([id, label]) => <a key={id} href={`#${id}`} onClick={jump(id)}>{label}</a>)}
          </nav>
          <div className="marketing-copy">
            <span className="marketing-eyebrow"><AutoAwesomeRounded /> תמלול, עריכה ועיצוב, במקום אחד</span>
            <h1 id="marketing-title">כתוביות בעברית<br /><span>שעוצרות את הגלילה.</span></h1>
            <p className="marketing-intro">מעלים סרטון ומקבלים תמלול מדויק עם תזמון לכל מילה. מתקנים, מעצבים ומורידים סרטון מוכן לשיתוף, ישירות מהדפדפן.</p>
            <div className="marketing-actions" ref={actionsRef}>
              <Button className="marketing-primary" variant="contained" onClick={start} disabled={authLoading} endIcon={<ArrowBackRounded />}>{authLoading ? "טוענים..." : "התחילו ליצור כתוביות"}</Button>
              <Button className="marketing-watch" onClick={showDemo} startIcon={<span className="marketing-watch-icon"><PlayArrowRounded /></span>}>צפו בדוגמה</Button>
            </div>
            <ul className="marketing-benefits" aria-label="מה מקבלים">
              {["עברית מימין לשמאל", "מילה אקטיבית", "SRT · VTT · סרטון צרוב"].map(item => <li key={item}><CheckRounded />{item}</li>)}
            </ul>
          </div>

          <section id="caption-demo" ref={demoRef} tabIndex={-1} className="marketing-demo" aria-label="הדגמה חיה של עורך הכתוביות">
            <div className="marketing-demo-glow" aria-hidden="true" />
            {wide ? <div className="qc-window">
              <div className="qc-window-bar" aria-hidden="true">
                <span className="qc-window-dots"><i /><i /><i /></span>
                <span className="qc-window-url"><VerifiedRounded /> quick-caption.com</span>
                <span className="qc-window-live"><b /> הדגמה חיה</span>
              </div>
              <DesktopEditorDemo demo={demo} onStart={start} />
            </div> : <PhoneEditorDemo demo={demo} onStart={start} />}
            <div className="marketing-float marketing-float-a" aria-hidden="true"><TimelineRounded /> דיוק עד רמת הפריים</div>
            <div className="marketing-float marketing-float-b" aria-hidden="true"><span>כל</span> <b>מילה</b> <span>בזמן</span></div>
            <div className="marketing-float marketing-float-c" aria-hidden="true"><DownloadRounded /> SRT · VTT · MP4</div>
          </section>
          <p className="marketing-demo-hint"><AutoAwesomeRounded /> {wide
            ? <>זה העורך עצמו. נסו <b>צבעים</b>, <b>מיקום</b>, <b>מילה אקטיבית</b>, או לחצו על כתובית בציר הזמן.</>
            : <>זה העורך בטלפון. הקישו על כתובית, או על <b>עיצוב</b> כדי להחליף סגנון.</>}</p>
        </div>
      </section>

      <div className="marketing-marquee" aria-label="מתאים לכל סוג תוכן">
        <div className="marketing-marquee-row">
          {[...useCases, ...useCases].map((item, index) => <span key={index} aria-hidden={index >= useCases.length || undefined}>{item}<i /></span>)}
        </div>
      </div>

      <section id="styles" ref={stylesRef} className="marketing-studio" aria-labelledby="marketing-studio-title">
        <div className="marketing-wrap">
          <div className="marketing-section-title">
            <span className="marketing-kicker">סטודיו הסגנונות</span>
            <h2 id="marketing-studio-title">בוחרים לוק. רואים אותו חי.</h2>
            <p>כל סגנון כאן בנוי מההגדרות שבעורך: צבע, מסגרת, מיקום ומילה אקטיבית.<br className="marketing-desktop-break" /> בחרו אחד ונסו אותו על ההדגמה.</p>
          </div>
          <div className="marketing-looks" ref={looksRef}>
            {LOOK_PRESETS.map(preset => <LookCard key={preset.id} name={preset.name} note={preset.note} look={preset.look} demo={gallery}
              selected={sameLook(demo.look, preset.look)} onApply={() => applyLook(preset.look)} />)}
          </div>
          {!wide && <CarouselDots target={looksRef} count={LOOK_PRESETS.length} label="מעבר בין סגנונות" behavior={behavior} />}
        </div>
      </section>

      <section id="how-it-works" className="marketing-process" aria-labelledby="marketing-process-title">
        <div className="marketing-wrap">
          <div className="marketing-section-title">
            <span className="marketing-kicker">פחות התעסקות. יותר יצירה.</span>
            <h2 id="marketing-process-title">מהסרטון שלכם, לתוצאה שלכם.</h2>
            <p>שלושה שלבים, והשליטה נשארת אצלכם.</p>
          </div>
          <ol className="marketing-steps">
            <li>
              <span className="marketing-step-number">01</span>
              <h3>מעלים סרטון או אודיו</h3>
              <p>גוררים קובץ לחלון או בוחרים אותו מהמחשב או מהטלפון.</p>
              <div className="marketing-step-visual marketing-dropzone" aria-hidden="true">
                <UploadFileRounded />
                <b>בחרו קובץ וידאו או אודיו</b>
                <span>ניתן לגרור קובץ לחלון או לבחור אותו מהמחשב שלכם</span>
                <em>עד 500MB לקובץ</em>
              </div>
            </li>
            <li>
              <span className="marketing-step-number">02</span>
              <h3>התמלול עובד בשבילכם</h3>
              <p>תמלול מתוזמן, שיפור דיוק ותיקון שפה. בסוף מקבלים כתוביות מחולקות ומוכנות לעריכה.</p>
              <div className="marketing-step-visual marketing-stages" aria-hidden="true">
                {[["העלאה", "done"], ["תמלול מתוזמן", "done"], ["שיפור דיוק", "active"], ["תיקון שפה", "idle"]].map(([label, state]) => <span key={label} className={`is-${state}`}><i>{state === "done" && <CheckRounded />}</i>{label}</span>)}
                <div className="marketing-stages-bar"><span /></div>
              </div>
            </li>
            <li>
              <span className="marketing-step-number">03</span>
              <h3>מעצבים ומורידים</h3>
              <p>מדייקים מילים ותזמון, בוחרים סגנון, ומורידים סרטון צרוב או קובץ כתוביות.</p>
              <div className="marketing-step-visual marketing-menu" aria-hidden="true">
                <span><SubtitlesRounded /> הורד קובץ כתוביות</span>
                <span className="is-hover"><MovieFilterRounded /> הורד סרטון עם כתוביות</span>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section id="features" ref={featuresRef} className="marketing-features" aria-labelledby="marketing-features-title">
        <div className="marketing-wrap">
          <div className="marketing-section-title">
            <span className="marketing-kicker">כל מה שצריך, בלי מה שלא</span>
            <h2 id="marketing-features-title">עורך שנבנה לעברית.</h2>
            <p>כלים מקצועיים שמרגישים פשוטים, במחשב ובטלפון.</p>
          </div>
          <div className="marketing-bento" ref={bentoRef}>
            <article className="marketing-tile marketing-tile-timeline">
              <div className="marketing-tile-copy"><span className="marketing-tile-icon"><TimelineRounded /></span><h3>ציר זמן מקצועי, פריים אחרי פריים</h3><p>גוררים, מקצרים, מפצלים ומחברים כתוביות. ניווט פריים־פריים, זום עם הגלגלת וקיצורי מקלדת.</p></div>
              <div className="marketing-mini-timeline" aria-hidden="true">
                <div className="marketing-mini-ruler">{["00:00:00:00", "00:00:02:00", "00:00:04:00", "00:00:06:00"].map(label => <span key={label}>{label}</span>)}</div>
                <div className="marketing-mini-row"><b style={{ left: "3%", width: "22%" }}>העליתי את הסרטון</b><b className="is-selected" style={{ left: "27%", width: "24%" }}>והכתוביות כבר כאן</b><b style={{ left: "53%", width: "21%" }}>מתקנים מילה בקליק</b><b style={{ left: "76%", width: "22%" }}>בוחרים צבע</b></div>
                <div className="marketing-mini-row is-words"><b style={{ left: "27%", width: "7%" }}>והכתוביות</b><b style={{ left: "35%", width: "5%" }}>כבר</b><b style={{ left: "41%", width: "5%" }}>כאן</b></div>
                <i className="marketing-mini-cursor" />
              </div>
            </article>
            <article className="marketing-tile marketing-tile-word">
              <div className="marketing-tile-copy"><span className="marketing-tile-icon"><RecordVoiceOverRounded /></span><h3>מילה אקטיבית</h3><p>המילה שנאמרת נדלקת בזמן אמת, בתצוגה ובסרטון הצרוב.</p></div>
              <div className="marketing-word-demo" aria-hidden="true"><span>כל</span> <span>מילה</span> <span>בזמן</span> <span>שלה</span></div>
            </article>
            <article className="marketing-tile marketing-tile-ai">
              <div className="marketing-tile-copy"><span className="marketing-tile-icon"><AutoFixHighRounded /></span><h3>עריכה עם AI</h3><p>כותבים מה לשנות, והכתוביות מתעדכנות תוך שמירה על התזמון.</p></div>
              <div className="marketing-ai-card" aria-hidden="true">
                <b>עריכת כתוביות עם AI</b>
                <span className="marketing-ai-input">תקצר את כל הכתוביות ל־5 מילים מקסימום<i /></span>
                <span className="marketing-ai-chips"><em>תתקן שגיאות כתיב</em><em>תאחד כתוביות קצרות</em></span>
                <span className="marketing-ai-button">בצע עריכה</span>
              </div>
            </article>
            {wide && <article className="marketing-tile marketing-tile-phone">
              <div className="marketing-tile-copy"><span className="marketing-tile-icon"><PhoneIphoneRounded /></span><h3>עורכים גם מהטלפון</h3><p>עורך מלא שמותאם למגע: ניגון, תיקון, תזמון ועיצוב.</p></div>
              <PhoneEditorDemo demo={gallery} onStart={start} decorative />
            </article>}
            <article className="marketing-tile marketing-tile-rtl">
              <div className="marketing-tile-copy"><span className="marketing-tile-icon"><FormatTextdirectionRToLRounded /></span><h3>עברית, מימין לשמאל</h3><p>פיסוק במקום, מילים באנגלית נשארות שלמות, ואפשר לעבור ל־LTR בלחיצה.</p></div>
              <div className="marketing-rtl-demo" aria-hidden="true"><span>היי! זה עובד גם עם English.</span><em><b>RTL</b><i>LTR</i></em></div>
            </article>
            <article className="marketing-tile marketing-tile-burn">
              <div className="marketing-tile-copy"><span className="marketing-tile-icon"><TuneRounded /></span><h3>מה שרואים, זה מה שנצרב</h3><p>אותו פונט ואותם חישובי גודל ומיקום בתצוגה ובסרטון הסופי.</p></div>
              <div className="marketing-formats" aria-hidden="true">{["SRT", "VTT", "TXT", "MP4 צרוב"].map(format => <span key={format}>{format}</span>)}</div>
            </article>
            <article className="marketing-tile marketing-tile-history">
              <div className="marketing-tile-copy"><span className="marketing-tile-icon"><VideoLibraryRounded /></span><h3>כל הפרויקטים במקום אחד</h3><p>היסטוריית הסרטונים נשמרת בחשבון, וחוזרים לערוך מתי שרוצים.</p></div>
              <div className="marketing-history" aria-hidden="true">
                {[["רילס-השקה.mp4", "היום"], ["פודקאסט פרק 12.mp3", "אתמול"], ["הדרכת-מוצר.mp4", "לפני 3 ימים"]].map(([name, when]) => <span key={name}><img src={DEMO_IMAGE} alt="" loading="lazy" />{name}<em>{when}</em></span>)}
              </div>
            </article>
          </div>
          {!wide && <CarouselDots target={bentoRef} count={6} label="מעבר בין יכולות" behavior={behavior} />}
        </div>
      </section>

      <section id="marketing-faq" className="marketing-faq" aria-labelledby="marketing-faq-title">
        <div className="marketing-wrap">
          <div className="marketing-faq-intro"><span className="marketing-kicker">טוב לדעת</span><h2 id="marketing-faq-title">לפני שמתחילים.</h2><p>כמה תשובות קצרות,<br />כדי שתוכלו להתמקד ביצירה.</p></div>
          <div className="marketing-questions">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
        </div>
      </section>

      <section className="marketing-final" ref={finalRef} aria-labelledby="marketing-final-title">
        <div className="marketing-wrap">
          <div className="marketing-final-card">
            <div className="marketing-aurora is-dark" aria-hidden="true"><i /><i /><i /></div>
            <span className="marketing-kicker">המילים כבר אצלכם.</span>
            <h2 id="marketing-final-title"><span>עכשיו</span> <span>תנו</span> <span>להן</span> <span>במה.</span></h2>
            <Button className="marketing-primary is-light" variant="contained" onClick={start} disabled={authLoading} endIcon={<ArrowBackRounded />}>לסרטון הבא שלכם</Button>
            <p>עברית. עיצוב. הסיפור שלכם.</p>
          </div>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="marketing-wrap">
          <img src="/quickcaption-logo.svg" width="165" height="36" alt="Quick Caption" />
          <span>כתוביות בעברית, בדרך שלכם.</span>
          <a href="#marketing-title" onClick={jump("marketing-title")}>בחזרה למעלה ↑</a>
        </div>
      </footer>

      {!wide && <div className={`marketing-dock ${dockVisible ? "is-visible" : ""}`} role="region" aria-label="פעולות מהירות">
        {isAuthenticated ? <>
          <Button className="marketing-primary" variant="contained" onClick={onStart} startIcon={<UploadFileRounded />}>סרטון חדש</Button>
          {onMyVideos && <Button className="marketing-dock-secondary" onClick={onMyVideos} startIcon={<VideoLibraryRounded />}>הסרטונים שלי</Button>}
        </> : <Button className="marketing-primary" variant="contained" onClick={start} disabled={authLoading} endIcon={<ArrowBackRounded />}>{authLoading ? "טוענים..." : "התחילו עכשיו"}</Button>}
      </div>}
    </main>
  );
}
