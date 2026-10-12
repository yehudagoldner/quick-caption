import { useEffect, useState } from 'react';
import { detectPlatform } from '../utils/premierePlatform';
import './PremiereDownloadPage.css';

type Platform = 'windows' | 'mac' | null;
const asset = (name: string) => import.meta.env.BASE_URL + name;

export function PremiereDownloadPage({ onHome }: { onHome: () => void }) {
  const [detected] = useState(() => detectPlatform(navigator));
  const [platform, setPlatform] = useState<Platform>(() => detected === 'windows' || detected === 'mac' ? detected : null);
  const [manual, setManual] = useState(false);
  const [downloadRequested, setDownloadRequested] = useState(false);
  const label = platform === 'windows' ? 'Windows' : 'Mac';
  const selectPlatform = (value: Exclude<Platform, null>) => {
    setPlatform(value); setManual(true); setDownloadRequested(false);
  };
  const platformNotice = manual ? `בחרתם ${label}. ההורדה וההוראות עודכנו.` :
    platform ? `זיהינו ${label} — זה המתקין המתאים למחשב שלכם. אפשר לבחור מערכת אחרת.` :
    detected === 'mobile' ? 'Premiere פועל במחשב. בחרו את המערכת של המחשב שבו תתקינו את התוסף.' :
    detected === 'unsupported' ? 'התוסף זמין ל־Windows ול־Mac. בחרו את המערכת של מחשב העריכה שלכם.' :
    'לא זיהינו את מערכת ההפעלה. בחרו Windows או Mac.';
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'התוסף ל־Premiere Pro | Quick Caption';
    const frame = requestAnimationFrame(() => {
      if (window.location.hash === '#tutorial') document.getElementById('tutorial')?.scrollIntoView();
    });
    return () => { document.title = previousTitle; cancelAnimationFrame(frame); };
  }, []);
  return <main className="premiere-download-page" dir="rtl" id="premiere-download">
    <div className="premiere-content">
      <button type="button" className="back-home" onClick={onHome}>← חזרה לדף הבית</button>

    <section className="hero" aria-labelledby="title">
      <div className="hero-copy">
        <p className="eyebrow" dir="ltr">QUICK CAPTION × PREMIERE PRO</p>
        <h1 id="title">מהדיבור שלכם.<br /><span>ישר לטיימליין.</span></h1>
        <p className="intro">סמנו קטעים בפרימייר, קבלו כתוביות בעברית והמשיכו לערוך באותו פרויקט.</p>
        <div className="features"><span>בחירה ישירות מהטיימליין</span><span>כתוביות שאפשר לערוך</span><span>הדגשת המילה הפעילה</span></div>
        <p className="release-note">גרסה 1.0.2 · 11 באוקטובר 2026<br />כוללת תיקון לחיבור המקומי של התוסף ל־Premiere.</p>
      </div>
      <div className="download-card">
        <div className="card-top"><span className="platform-icon" aria-hidden="true">↓</span><span className="beta-label" id="platform-badge">{platform ? `בטא ל־${label}` : 'גרסת בטא'}</span></div>
        <h2 id="download-title">{platform ? `Quick Caption ל־${label}` : 'מתקין Quick Caption'}</h2>
        <p>מתקין אחד לשני רכיבי התוסף.</p>
        <p className="detected-platform" id="platform-detection" role="status">{platformNotice}</p>
        <div className="platform-switch" id="platform-switch" role="group" aria-label="בחירת מערכת הפעלה">
          <button type="button" data-platform="windows" aria-pressed={platform === 'windows'} onClick={() => selectPlatform('windows')}>Windows</button>
          <button type="button" data-platform="mac" aria-pressed={platform === 'mac'} onClick={() => selectPlatform('mac')}>Mac</button>
        </div>
        <div className="platform-download" data-platform-panel="windows" hidden={platform !== null && platform !== 'windows'}>
          <h3 className="platform-heading" hidden={platform !== null}>Windows</h3>
          <a className="download-button" href={asset('downloads/premiere/QuickCaption-Setup-1.0.2-Windows.exe')} data-installer="windows" onClick={() => setDownloadRequested(true)} download>הורדה ל־Windows <span aria-hidden="true">↓</span></a>
          <p className="requirements"><bdi>Windows 10/11 · 64-bit</bdi> · Premiere Pro 25.6 ומעלה<br />נדרש Creative Cloud Desktop מותקן ומעודכן.</p>
          <p className="download-alternative">ההורדה לא התחילה? <a href={asset('downloads/premiere/QuickCaption-Installer-1.0.2-Windows.zip')} data-installer="windows-zip" onClick={() => setDownloadRequested(true)} download>הורידו את המתקין בקובץ ZIP</a> וחלצו אותו לפני ההתקנה.</p>
        </div>
        <div className="platform-download" data-platform-panel="mac" hidden={platform !== null && platform !== 'mac'}>
          <h3 className="platform-heading" hidden={platform !== null}>Mac</h3>
          <a className="download-button" href={asset('downloads/premiere/QuickCaption-Installer-1.0.2-Mac-Beta.zip')} data-installer="mac" onClick={() => setDownloadRequested(true)} download>הורדה למאק <span aria-hidden="true">↓</span></a>
          <p className="requirements">macOS 13 ומעלה · Apple Silicon ו־Intel · Premiere Pro 25.6 ומעלה<br />נדרש Creative Cloud Desktop מותקן ומעודכן.</p>
        </div>
        <p className="download-status" id="download-status" role="status" hidden={!downloadRequested}>בקשת ההורדה נשלחה. בדקו את רשימת ההורדות של הדפדפן; אם מופיעה חסימה, שלחו לנו את נוסח ההודעה.</p>

      </div>
    </section>
    <aside className="beta-note" data-platform-panel="windows" hidden={platform !== null && platform !== 'windows'} aria-label="מצב גרסת Windows"><strong>גרסת בדיקה ל־Windows</strong><p>המתקין טרם חתום בחתימת מפרסם של Windows. אם הדפדפן או Windows חוסמים אותו, שלחו לנו את נוסח ההודעה כדי שנוכל לבדוק. התוסף מתחבר לחשבון QA; תמלול צורך קרדיטים לפי המחיר שמוצג לפני השליחה.</p></aside>
    <aside className="beta-note" data-platform-panel="mac" hidden={platform !== null && platform !== 'mac'} aria-label="מצב גרסת המאק"><strong>גרסת בדיקה למאק</strong><p>החבילה טרם נבדקה במאק אמיתי ואינה חתומה או מאושרת ב־Apple. רכיב Adobe נחתם ב־Windows, ולכן ההתקנה במאק עדיין דורשת אימות. התוסף מתחבר לחשבון QA; תמלול צורך קרדיטים לפי המחיר שמוצג לפני השליחה.</p></aside>
    <section className="tutorial" id="tutorial" aria-labelledby="tutorial-title">
      <div className="section-heading"><p className="eyebrow">רואים איך זה עובד</p><h2 id="tutorial-title">מהבחירה בטיימליין ועד לכתוביות</h2><p>44 שניות מתוך Premiere Pro: בחירת קטע, הגדרות בעברית, יצירת כתוביות והמשך עריכה.</p></div>
      <video controls playsInline preload="metadata" width="1920" height="1080" poster={asset('premiere-tutorial.jpg')} aria-label="סרטון הדרכה לשימוש ב־Quick Caption בפרימייר" aria-describedby="tutorial-note">
        <source src={asset('premiere-tutorial-silent.mp4')} type="video/mp4" />
        הדפדפן אינו תומך בניגון הסרטון. <a href={asset('premiere-tutorial-silent.mp4')}>פתיחת סרטון ההדרכה</a>
      </video>
      <p className="tutorial-note" id="tutorial-note">צילום מסך אמיתי ב־Windows ובסביבת QA, עם הסברים בעברית, זום וסימונים. הסרטון ללא שמע; זמן העיבוד קוצר בעריכה.</p>
      <details><summary>שלבי ההדרכה בכתב</summary><ol className="tutorial-transcript">
        <li>מסמנים בטיימליין את הווידאו ואת האודיו שרוצים לתמלל.</li>
        <li>פותחים <bdi>Window → UXP Plugins → Quick Caption QA</bdi>. בשימוש הראשון מחברים את חשבון Quick Caption.</li>
        <li>בוחרים עברית ואת אורך הכתוביות. בדוגמה נבחרו עד 5 מילים לכל כתובית.</li>
        <li>בודקים את הערכת הקרדיטים ולוחצים על יצירת כתוביות. התוסף שולח את האודיו לתמלול ומוסיף את הכתוביות לטיימליין.</li>
        <li>מנגנים את הקטע ובודקים את הטקסט והתזמון.</li>
        <li>לוחצים פעמיים על כתובית כדי לפתוח את כלי העריכה של Premiere, לתקן טקסט ולשנות עיצוב.</li>
      </ol></details>
    </section>
    <section className="installation" aria-labelledby="installation-title">
      <div className="section-heading"><p className="eyebrow">מתחילים כאן</p><h2 id="installation-title">{platform ? `התקנה ב־${label}, צעד אחר צעד` : 'התקנה, צעד אחר צעד'}</h2><p>אין צורך ב־Node.js או בכלי פיתוח.</p></div>
      <ol className="steps" data-platform-panel="windows" hidden={platform !== null && platform !== 'windows'} aria-label="התקנה ב־Windows">
        <li><div><h3>מורידים את המתקין</h3><p>לחצו על <strong>הורדה ל־Windows</strong>. הקובץ נקרא <bdi>QuickCaption-Setup-1.0.2-Windows.exe</bdi>. אפשר למצוא אותו גם ברשימת ההורדות של הדפדפן.</p></div></li>
        <li><div><h3>שומרים וסוגרים את Premiere</h3><p>שמרו את הפרויקט וסגרו את פרימייר לגמרי. פתחו את Creative Cloud Desktop והתחברו לחשבון Adobe שלכם.</p></div></li>
        <li><div><h3>מפעילים את המתקין</h3><p>פתחו את קובץ ה־EXE שהורדתם ולחצו על <strong>התקנה</strong>. המשיכו רק אחרי שהמתקין מאשר ששני הרכיבים מותקנים ופעילים.</p></div></li>
        <li><div><h3>פותחים את התוסף ומתחברים</h3><p>פתחו מחדש את Premiere ובחרו <bdi>Window → UXP Plugins → Quick Caption QA</bdi>. התחברו ל־Quick Caption ואשרו את החיבור בחשבון QA.</p></div></li>
      </ol>
      <ol className="steps" data-platform-panel="mac" hidden={platform !== null && platform !== 'mac'} aria-label="התקנה במאק">
        <li><div><h3>מורידים ומחלצים</h3><p>הורידו את קובץ ה־ZIP וחלצו אותו בלחיצה כפולה. אם יש גרסה ישנה, השתמשו במתקין החדש כדי לעדכן.</p></div></li>
        <li><div><h3>שומרים וסוגרים את Premiere</h3><p>שמרו את הפרויקט וסגרו את פרימייר לגמרי. פתחו את Creative Cloud Desktop והתחברו לחשבון Adobe שלכם.</p></div></li>
        <li><div><h3>מפעילים את המתקין</h3><p>פתחו <bdi>Quick Caption Setup.app</bdi> ולחצו על <strong>התקנה</strong>. המשיכו רק אחרי שהמתקין מאשר ששני הרכיבים מותקנים ופעילים.</p><p>אם חלון המתקין אינו מופיע, פתחו את <bdi>Install Quick Caption.command</bdi> מהתיקייה שחילצתם.</p></div></li>
        <li><div><h3>פותחים את התוסף ומתחברים</h3><p>פתחו מחדש את Premiere ובחרו <bdi>Window → UXP Plugins → Quick Caption QA</bdi>. התחברו ל־Quick Caption ואשרו את החיבור בחשבון QA.</p></div></li>
      </ol>
      <details data-platform-panel="mac" hidden={platform !== null && platform !== 'mac'}><summary>macOS חוסם את פתיחת המתקין?</summary><p>אם ההודעה היא שהמפתח אינו מזוהה, נסו לפתוח פעם אחת ואז עברו ל־<bdi>System Settings → Privacy &amp; Security → Open Anyway</bdi> עבור המתקין הזה. אין צורך לכבות את Gatekeeper או להריץ פקודות להסרת quarantine.</p><p>אם ההודעה אומרת שהאפליקציה פגומה או מזיקה, עצרו והעבירו לנו את נוסח ההודעה. במחשב של ארגון ייתכן שנדרש אישור מנהל המערכת.</p></details>
      <details className="connection-help"><summary>למה התוסף מתחבר גם ל־localhost?</summary><p>החשבון, הקרדיטים והתמלול מתקשרים עם שרת QA של Quick Caption באינטרנט. כדי להציב את הכתוביות בטיימליין, התוסף מתקשר גם עם רכיב שמותקן במחשב שלכם יחד עם התוסף.</p><p><bdi>localhost</bdi> הוא המחשב שבו Premiere פועל — במאק, זה המאק שלכם. אין צורך בגישה למחשב של אדם אחר או בהתקנת שרת נפרד.</p></details>
    </section>
    <section className="bottom-grid">
      <article className="info-card"><p className="eyebrow">הבדיקה הראשונה</p><h2>מתחילים מקטע קצר</h2><p>סמנו קטע עם דיבור והתחילו עם כתוביות רגילות. ודאו שהכתוביות מופיעות במקום הנכון, ואז נסו שני קטעים והדגשת מילה פעילה.</p><p>להדגשת המילה הפעילה נדרשת תבנית Adobe המקורית <bdi>Classic Web Caption</bdi>. אם היא חסרה, הוסיפו אותה דרך ממשק תבניות הגרפיקה של Adobe. אפשר להתחיל עם כתוביות רגילות גם בלעדיה.</p></article>
      <article className="info-card"><p className="eyebrow">אם משהו נעצר</p><h2>איך מדווחים על תקלה?</h2><p data-platform-panel="windows" hidden={platform !== null && platform !== 'windows'}><strong>במהלך ההתקנה ב־Windows:</strong> שלחו את נוסח השגיאה ואת קובץ <bdi>last-install.json</bdi> מתוך <bdi>%LOCALAPPDATA%\Quick Caption\Installer</bdi>, אם נוצר.</p><p data-platform-panel="mac" hidden={platform !== null && platform !== 'mac'}><strong>במהלך ההתקנה במאק:</strong> פתחו <bdi>Quick Caption Diagnostics.command</bdi>, בחרו <strong>שמירת דוח</strong> ושלחו לנו את קובץ ה־JSON ואת נוסח השגיאה.</p><p><strong>בתוך התוסף, לאחר התחברות:</strong> העתיקו את קוד האבחון שמופיע ליד השגיאה. הוא מאפשר לנו למצוא את דוח התקלה ב־QA.</p><p className="muted">דוח ההתקנה נשאר במחשב; מזהה הדוח לבדו אינו מספיק לשליפתו. אין צורך לשלוח קובצי פרויקט או מדיה.</p></article>
    </section>
    <footer><span>Quick Caption · Premiere QA · גרסה 1.0.2</span><a href={asset('downloads/premiere/SHA256SUMS')} download>בדיקת שלמות הקבצים · SHA-256</a></footer>

    </div>
  </main>;
}
