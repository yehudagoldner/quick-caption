import { test, expect, type Page } from '@playwright/test';
import { portraitVideo } from './app-fixtures';

const original = [
  { id: 1, start: .4, end: 1.8, text: 'שלום עולם' },
  { id: 2, start: 2.1, end: 3.5, text: 'סרטון לבדיקה' },
  { id: 3, start: 3.8, end: 4.8, text: 'כתובית אחרונה' },
];
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function setup(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const state = { segments: structuredClone(original), words: [] as unknown[], saves: 0, completed: 0, reject: false,
    gate: null as ReturnType<typeof deferred> | null, errors: [] as string[], headers: [] as string[], burns: [] as string[] };
  page.on('pageerror', error => state.errors.push(error.message));
  // Vite may retain several HMR versions of this module in an existing dev
  // server. Register the fixture identity in each one, just as AuthProvider does.
  await page.route('**/src/client/api.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `\nsetApiUser({ uid: 'regression-owner', getIdToken: async () => 'verified-fixture-token' });` });
  });
  await page.route('**/src/client/contexts/AuthContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `
    import { setApiUser } from '/src/client/api.ts';
    const user = { uid: 'regression-owner', displayName: 'QA', getIdToken: async () => 'verified-fixture-token' }; setApiUser(user);
    export const useAuth = () => ({ user, loading: false, signIn: async () => {}, signOut: async () => {} });
    export const AuthProvider = ({ children }) => children;` }));
  await page.routeWebSocket('**/socket.io/**', () => {});
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const request = route.request();
    if (!url.pathname.endsWith('/media')) state.headers.push(request.headers().authorization ?? '');
    if (url.pathname === '/api/videos/load') return route.fulfill({ json: { mediaToken: 'signed-media-fixture', video: {
      id: 42, subtitle_json: state.segments, words_json: state.words, format: '.srt', stored_path: 'fixture.webm',
    } } });
    if (url.pathname === '/api/videos/42/token') return route.fulfill({ json: { token: 'fixture-edit-token' } });
    if (url.pathname === '/api/videos/update-subtitles') {
      state.saves++;
      const body = request.postDataJSON();
      if (state.gate) await state.gate.promise;
      if (state.reject) return route.fulfill({ status: 500, json: { error: 'Controlled save failure' } });
      state.segments = JSON.parse(body.subtitleJson); state.words = JSON.parse(body.wordsJson ?? '[]');
      state.completed++;
      return route.fulfill({ json: { success: true } });
    }
    if (url.pathname.endsWith('/media') || url.pathname.endsWith('/file')) {
      const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Number(range[2]) : portraitVideo.length - 1;
      return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}) }, body: portraitVideo.subarray(start, end + 1) });
    }
    if (url.pathname === '/api/burn-subtitles') {
      state.burns.push(request.postDataBuffer()!.toString());
      return route.fulfill({ contentType: 'video/webm', headers: { 'Content-Disposition': 'attachment; filename="fixture.webm"' }, body: portraitVideo });
    }
    if (url.pathname === '/api/videos') return route.fulfill({ json: { videos: [{ id: 42, original_filename: 'QA.webm',
      status: 'completed', media_type: 'video', has_subtitles: true, duration_seconds: 5, created_at: '2026-10-02' }] } });
    return route.fulfill({ json: { credits: 50, isAdmin: false } });
  });
  const open = async () => {
    await page.goto('/?screen=edit&video=fixture-edit-token');
    await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  };
  return { state, open };
}

test('delayed acknowledgement preserves newer sidebar text and saves it on blur', async ({ page }) => {
  const { state, open } = await setup(page); await open();
  state.gate = deferred();
  await expect(page.getByRole('button', { name: 'הסתר עורך', exact: true })).toBeVisible();
  const field = page.getByRole('textbox', { name: 'טקסט הכתובית', exact: true }).first();
  await field.fill('גרסה ראשונה'); await field.blur();
  await expect.poll(() => state.saves).toBe(1);
  await field.fill('גרסה שנייה בזמן השמירה'); state.gate.release();
  await expect.poll(() => state.completed).toBe(1);
  await expect(field).toHaveValue('גרסה שנייה בזמן השמירה');
  await field.blur(); await expect.poll(() => state.segments[0].text).toBe('גרסה שנייה בזמן השמירה');
  await page.reload(); await page.getByTestId('subtitle-clip').first().click();
  await expect(page.getByRole('textbox', { name: 'טקסט המקטע' })).toHaveValue('גרסה שנייה בזמן השמירה');
  expect(state.errors).toEqual([]);
});

test('browser Back restores the editor while dirty and preserves Back/Forward after saving', async ({ page }) => {
  const { state } = await setup(page);
  await page.goto('/?screen=videos'); await page.getByRole('button', { name: 'המשך עריכה' }).click();
  await page.getByTestId('subtitle-clip').first().click();
  const field = page.getByRole('textbox', { name: 'טקסט המקטע' });
  state.gate = deferred(); await field.fill('טיוטה לפני חזרה');
  await expect(page.getByRole('button', { name: 'לסרטונים שלי', exact: true })).toBeDisabled();
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/screen=edit/); await expect(field).toHaveValue('טיוטה לפני חזרה');
  await field.blur(); await expect.poll(() => state.saves).toBeGreaterThan(0); state.gate.release();
  await expect(page.getByRole('button', { name: 'לסרטונים שלי', exact: true })).toBeEnabled();
  await page.evaluate(() => history.back()); await expect(page.getByRole('button', { name: 'המשך עריכה' })).toBeVisible();
  await page.evaluate(() => history.forward()); await expect(page).toHaveURL(/screen=edit/);
  await page.getByTestId('subtitle-clip').first().click(); await expect(field).toHaveValue('טיוטה לפני חזרה');
});

test('profile purchase and signout cannot bypass a failed subtitle save', async ({ page }) => {
  const { state, open } = await setup(page); await open(); state.reject = true;
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByRole('textbox', { name: 'טקסט המקטע' }).fill('טיוטה מוגנת');
  await page.getByRole('button', { name: 'תפריט', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'רכישת קרדיטים' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'התנתקות' })).toBeDisabled();
  await expect(page).toHaveURL(/screen=edit/);
  await page.keyboard.press('Escape'); state.reject = false;
  await expect.poll(() => state.segments[0].text, { timeout: 7000 }).toBe('טיוטה מוגנת');
  await page.getByRole('button', { name: 'תפריט', exact: true }).click();
  await page.getByRole('menuitem', { name: 'רכישת קרדיטים' }).click(); await expect(page).toHaveURL(/screen=buy-credits/);
});

test('adding inside an existing caption is rejected without saving or trimming neighbours', async ({ page }) => {
  const { state, open } = await setup(page); await open();
  await page.getByTestId('subtitle-clip').first().click(); await page.getByTestId('subtitle-clip').first().press('ArrowDown');
  await page.getByRole('button', { name: 'הוסף כתובית', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('חופף'); expect(state.saves).toBe(0);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await page.reload(); expect(state.segments).toEqual(original);
  // The initial 0-.4 gap is too short for the default .5-second caption too.
  await page.getByRole('button', { name: 'הוסף כתובית', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('חופף');
});

test('closing an empty draft allows single-click reopening and cancellation', async ({ page }) => {
  const { state, open } = await setup(page); await open();
  await page.getByTestId('subtitle-clip').first().click(); await page.getByRole('textbox', { name: 'טקסט המקטע' }).fill('');
  await page.getByRole('button', { name: 'סגור עורך', exact: true }).click();
  await expect(page.getByTestId('segment-inspector')).toHaveCount(0);
  await page.getByTestId('subtitle-clip').first().click();
  await expect(page.getByRole('textbox', { name: 'טקסט המקטע' })).toHaveValue('');
  await page.getByRole('button', { name: 'ביטול טיוטה', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'טקסט המקטע' })).toHaveValue('שלום עולם');
  await expect(page.getByRole('button', { name: 'לסרטונים שלי', exact: true })).toBeEnabled(); expect(state.saves).toBe(0);
});

test('AI failure keeps instructions and a durable error, then permits a successful retry', async ({ page }) => {
  const { state, open } = await setup(page); await open(); let fail = true;
  await page.route('**/api/ai-edit-subtitles', route => fail ? route.fulfill({ status: 503, json: { error: 'offline' } })
    : route.fulfill({ json: { segments: original.map(s => ({ ...s, text: s.text + ' מתוקן' })), words: [] } }));
  await page.getByRole('button', { name: 'עריכה עם AI', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'מה לעשות?' }); await field.fill('תקן שגיאות כתיב');
  await page.getByRole('button', { name: 'בצע עריכה', exact: true }).click();
  await expect(page.getByText('עריכת AI נכשלה. ההוראות נשמרו; אפשר לנסות שוב.')).toBeVisible();
  await page.waitForTimeout(2500); await expect(field).toHaveValue('תקן שגיאות כתיב');
  await expect(page.getByText('עריכת AI נכשלה. ההוראות נשמרו; אפשר לנסות שוב.')).toBeVisible();
  fail = false; await page.getByRole('button', { name: 'בצע עריכה', exact: true }).click();
  await expect(field).toBeHidden(); await expect.poll(() => state.segments[0].text).toBe('שלום עולם מתוקן'); expect(state.errors).toEqual([]);
});

test('blur save failure is handled and autosave success clears both error indicators', async ({ page }) => {
  const { state, open } = await setup(page); await open(); state.reject = true;
  await page.getByTestId('subtitle-clip').first().click(); const field = page.getByRole('textbox', { name: 'טקסט המקטע' });
  await field.fill('טקסט לשמירה חוזרת'); await field.blur();
  await expect(page.getByText('שמירת השינויים נכשלה. נסו שוב.', { exact: true }).first()).toBeVisible();
  state.reject = false; await expect.poll(() => state.segments[0].text, { timeout: 7000 }).toBe('טקסט לשמירה חוזרת');
  await expect(page.getByRole('alert')).toHaveCount(0); expect(state.errors).toEqual([]);
});

test('editing captions invalidates a ready burned download and regenerates from current text', async ({ page }) => {
  const { state, open } = await setup(page); await open();
  const burn = async () => {
    await page.getByRole('button', { name: 'הורדה', exact: true }).click(); const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click(); await download;
  };
  await burn(); await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'הורד סרטון צרוב מוכן', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByTestId('subtitle-clip').first().click(); const field = page.getByRole('textbox', { name: 'טקסט המקטע' });
  await field.fill('כתובית חדשה לצריבה'); await field.blur(); await expect.poll(() => state.segments[0].text).toBe('כתובית חדשה לצריבה');
  await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'הורד סרטון צרוב מוכן', exact: true })).toHaveCount(0); await page.keyboard.press('Escape');
  await burn(); expect(state.burns).toHaveLength(2); expect(state.burns[1]).toContain('כתובית חדשה לצריבה');
  expect(state.headers.every(header => header === 'Bearer verified-fixture-token')).toBe(true);
});

test('project 51 is reachable through pagination', async ({ page }) => {
  await setup(page);
  const videos = Array.from({ length: 51 }, (_, index) => ({ id: index + 1, original_filename: `project-${index + 1}.webm`,
    status: 'completed', media_type: 'video', has_subtitles: 1, duration_seconds: 5, created_at: '2026-10-02' }));
  await page.route('**/api/videos?**', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
    return route.fulfill({ json: { videos: videos.slice(offset, offset + 50), hasMore: offset + 50 < videos.length } });
  });
  await page.goto('/?screen=videos'); await expect(page.getByText('50+ פרויקטים')).toBeVisible();
  await page.getByRole('button', { name: 'טען פרויקטים נוספים' }).click();
  await expect(page.getByText('project-51', { exact: true })).toBeVisible(); await expect(page.getByText('51 פרויקטים')).toBeVisible();
  await expect(page.getByRole('button', { name: 'טען פרויקטים נוספים' })).toHaveCount(0);
  await page.route('**/api/videos/51/token?**', route => route.fulfill({ json: { token: 'project-51-session' } }));
  await page.getByRole('listitem').filter({ hasText: 'project-51' }).getByRole('button', { name: 'המשך עריכה' }).click();
  await expect(page).toHaveURL(/video=project-51-session/);
  await expect(page.getByTestId('caption-track')).toBeVisible();
});

test('failed project opening displays an actionable error and the same action can retry', async ({ page }) => {
  await setup(page); let fail = true;
  await page.route('**/api/videos/42/token?**', route => fail ? route.fulfill({ status: 500, json: { error: 'offline' } }) : route.fulfill({ json: { token: 'fixture-edit-token' } }));
  await page.goto('/?screen=videos'); await page.getByRole('button', { name: 'המשך עריכה' }).click();
  await expect(page.getByRole('alert')).toContainText('לא ניתן לפתוח'); await expect(page).not.toHaveURL(/screen=edit/);
  fail = false; await page.getByRole('button', { name: 'המשך עריכה' }).click(); await expect(page.getByTestId('caption-track')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('repeated saves retain one export Blob URL and leaving releases it', async ({ page }) => {
  const { state, open } = await setup(page);
  await page.addInitScript(() => {
    const live = new Set<string>(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); live.add(url); return url; };
    URL.revokeObjectURL = url => { live.delete(url); revoke(url); };
    (window as any).__liveExportUrls = live;
  });
  await open();
  for (let index = 0; index < 5; index++) {
    await page.getByTestId('subtitle-clip').first().click(); const field = page.getByRole('textbox', { name: 'טקסט המקטע' });
    await field.fill(`שינוי ${index}`); await field.blur(); await expect.poll(() => state.segments[0].text).toBe(`שינוי ${index}`);
  }
  await expect.poll(() => page.evaluate(() => (window as any).__liveExportUrls.size)).toBe(1);
  await page.getByRole('button', { name: 'לסרטונים שלי', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__liveExportUrls.size)).toBe(0);
});

test('caption style survives reload and stays scoped to its project', async ({ page }) => {
  const { open } = await setup(page); await open();
  await page.getByRole('button', { name: 'צבעים', exact: true }).click(); await page.getByLabel('צבע טקסט', { exact: true }).fill('#ff0000');
  await page.keyboard.press('Escape'); await page.reload();
  await page.getByRole('button', { name: 'צבעים', exact: true }).click(); await expect(page.getByLabel('צבע טקסט', { exact: true })).toHaveValue('#ff0000');
  await page.keyboard.press('Escape');
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { mediaToken: 'other-fixture', video: { id: 43, subtitle_json: original, words_json: [], format: '.srt' } } }));
  await page.goto('/?screen=edit&video=other-token'); await page.getByRole('button', { name: 'צבעים', exact: true }).click();
  await expect(page.getByLabel('צבע טקסט', { exact: true })).toHaveValue('#ffffff');
});

test('upload XHR carries identity and recovered playback uses its signed media grant', async ({ page }) => {
  const { state } = await setup(page);
  let uploadHeader = '';
  await page.route('**/api/transcribe', route => {
    uploadHeader = route.request().headers().authorization ?? '';
    return route.fulfill({ json: { videoId: 42, segments: original, words: [], subtitle: { format: '.srt', content: 'fixture' } } });
  });
  await page.goto('/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await page.getByRole('button', { name: 'שלחו לעיבוד' }).click();
  await expect(page.getByTestId('caption-track')).toBeVisible();
  expect(uploadHeader).toBe('Bearer verified-fixture-token');
  await page.addInitScript(() => localStorage.setItem('quickcaption:transcription-job:regression-owner', '11111111-1111-4111-8111-111111111111'));
  await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: { status: 'completed', result: {
    videoId: 42, mediaToken: 'recovery-media-grant', segments: original, words: [], subtitle: { format: '.srt', content: 'fixture' },
  } } }));
  await page.reload();
  await expect(page.locator('video')).toHaveAttribute('src', /media\?mediaToken=recovery-media-grant/);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  expect(state.errors).toEqual([]);
});
