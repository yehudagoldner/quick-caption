import { test, expect, type Page } from '@playwright/test';
import { portraitVideo } from './app-fixtures';

const uid = 'transcription-recovery-test';
const storageKey = `quickcaption:transcription-job:${uid}`;
const oldJobId = '11111111-1111-4111-8111-111111111111';
const result = {
  text: 'תמלול חדש',
  segments: [{ id: 1, start: 0, end: 1, text: 'תמלול חדש' }],
  subtitle: { format: '.srt', content: '1\n00:00:00,000 --> 00:00:01,000\nתמלול חדש\n' },
};

async function prepare(page: Page, savedJob = false) {
  // Keep these recovery tests independent of Firebase and paid transcription services.
  await page.route('**/src/client/contexts/AuthContext.tsx', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export const useAuth = () => ({ user: { uid: '${uid}', displayName: 'Test' }, loading: false, signIn: async () => {}, signOut: async () => {} }); export const AuthProvider = ({ children }) => children;`,
  }));
  await page.route('**/api/**', route => route.fulfill({ json: { credits: 100, videos: [] } }));
  await page.routeWebSocket('**/socket.io/**', socket => {
    socket.send('0{"sid":"recovery-test","upgrades":[],"pingInterval":25000,"pingTimeout":20000}');
    socket.onMessage(message => {
      if (message === '40') socket.send('40{"sid":"recovery-test"}');
    });
  });
  if (savedJob) {
    await page.addInitScript(({ key, id }) => {
      // Seed once so a reload really checks that recovery cleared the saved job.
      if (!sessionStorage.getItem('recovery-seeded')) {
        localStorage.setItem(key, id);
        sessionStorage.setItem('recovery-seeded', 'true');
      }
    }, { key: storageKey, id: oldJobId });
  }
}

async function chooseFile(page: Page, name = 'replacement.wav') {
  await page.locator('input[type=file]').setInputFiles({
    name, mimeType: 'audio/wav', buffer: Buffer.alloc(128),
  });
  await expect(page.getByRole('button', { name: 'שלחו לעיבוד' })).toBeEnabled();
}

async function mockWakeLock(page: Page, mode: 'supported' | 'denied' | 'unsupported' | 'deferred' = 'supported') {
  await page.addInitScript(mode => {
    const state = { requests: 0, releases: 0, resolve: () => {} };
    (window as any).__wakeLockTest = state;
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: mode === 'unsupported' ? undefined : {
      request: async () => {
        state.requests++;
        if (mode === 'denied') throw new DOMException('Power saving', 'NotAllowedError');
        if (mode === 'deferred') await new Promise<void>(resolve => { state.resolve = resolve; });
        const sentinel = Object.assign(new EventTarget(), { released: false, release: async () => {
          if (sentinel.released) return;
          sentinel.released = true;
          state.releases++;
          sentinel.dispatchEvent(new Event('release'));
        } });
        return sentinel;
      },
    } });
  }, mode);
}

async function setVisibility(page: Page, hidden: boolean) {
  await page.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('mobile upload warns until server confirmation, manages screen lock and recovers after returning', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await prepare(page);
  await mockWakeLock(page);
  await page.addInitScript(() => {
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
      if (body instanceof FormData && body.has('jobId')) (window as any).__uploadRequest = this;
      return send.call(this, body);
    };
  });
  let accepted = false, completed = false;
  let releaseUpload!: () => void;
  const pending = new Promise<void>(resolve => { releaseUpload = resolve; });
  await page.route('**/api/transcribe', async route => { await pending; await route.fulfill({ json: result }).catch(() => {}); });
  await page.route('**/api/transcribe/jobs/**', route => route.fulfill({
    status: accepted ? 200 : 404,
    json: completed ? { status: 'completed', result } : accepted ? { status: 'processing' } : { error: 'Job not found' },
  }));
  await page.goto('/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: 'portrait.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await page.getByRole('button', { name: 'שלחו לעיבוד' }).click();
  const warning = page.getByRole('alert').filter({ hasText: 'אל תנעלו את המסך' });
  await expect(warning).toBeInViewport();
  // Playwright holds the intercepted POST before Chromium reports transfer
  // completion. Deliver that event independently of the server's acknowledgement.
  await page.evaluate(() => {
    const upload = (window as any).__uploadRequest.upload;
    upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: 100, total: 100 }));
    upload.dispatchEvent(new ProgressEvent('load'));
  });
  await expect(page.getByText('ממתינים לאישור קליטת הסרטון בשרת...')).toBeVisible();
  await expect(page.getByText('הסרטון נקלט בשרת.', { exact: false })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__wakeLockTest.requests)).toBe(1);
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  await expect(page.getByRole('button', { name: 'חזרה לבחירת קובץ' })).toBeInViewport();
  await page.screenshot({ path: 'tmp/review/upload-warning-320.png' });
  await setVisibility(page, true);
  await expect.poll(() => page.evaluate(() => (window as any).__wakeLockTest.releases)).toBe(1);
  await setVisibility(page, false);
  await expect.poll(() => page.evaluate(() => (window as any).__wakeLockTest.requests)).toBe(2);
  await expect(warning).toBeVisible();
  accepted = true;
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.getByRole('status').filter({ hasText: 'הסרטון נקלט בשרת.' })).toBeVisible();
  await expect(warning).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__wakeLockTest.releases)).toBe(2);
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  await setVisibility(page, true);
  completed = true;
  await setVisibility(page, false);
  await expect(page.getByTestId('mobile-caption-editor')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  releaseUpload();
});

for (const mode of ['denied', 'unsupported'] as const) {
  test(`mobile upload remains usable with ${mode} wake lock support`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page, true);
    await mockWakeLock(page, mode);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ status: 404, json: { error: 'Job not found' } }));
    await page.goto('/?screen=transcription');
    await expect(page.getByRole('alert').filter({ hasText: 'אל תנעלו את המסך' })).toBeVisible();
    await expect(page.getByText('הסרטון נקלט בשרת.', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'חזרה לבחירת קובץ' }).click();
    await expect(page.getByTestId('media-dropzone')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('a wake lock granted after cancelling an upload is released immediately', async ({ page }) => {
  await prepare(page, true);
  await mockWakeLock(page, 'deferred');
  await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ status: 404, json: { error: 'Job not found' } }));
  await page.goto('/?screen=transcription');
  await expect.poll(() => page.evaluate(() => (window as any).__wakeLockTest.requests)).toBe(1);
  await page.getByRole('button', { name: 'חזרה לבחירת קובץ' }).click();
  await page.evaluate(() => (window as any).__wakeLockTest.resolve());
  await expect.poll(() => page.evaluate(() => (window as any).__wakeLockTest.releases)).toBe(1);
});

test('mobile: leave a restored processing job and stay unlocked after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, true);
  await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: { status: 'processing' } }));
  await page.goto('/?screen=transcription');
  await expect(page.getByText('בודקים את מצב העיבוד בשרת...')).toBeVisible();
  const back = page.getByRole('button', { name: 'חזרה לבחירת קובץ' });
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page.getByTestId('media-dropzone')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  await page.reload();
  await expect(page.getByTestId('media-dropzone')).toBeVisible();
  await chooseFile(page);
});

test('late poll completion cannot replace the next selected file', async ({ page }) => {
  await prepare(page, true);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let polling = false;
  await page.route('**/api/transcribe/jobs/**', async route => {
    polling = true;
    await pending;
    await route.fulfill({ json: { status: 'completed', result } }).catch(() => {});
  });
  await page.goto('/?screen=transcription');
  await expect.poll(() => polling).toBe(true);
  await page.getByRole('button', { name: 'חזרה לבחירת קובץ' }).click();
  await chooseFile(page);
  release();
  // Cross the original polling interval to catch a resurrected watcher.
  await page.waitForTimeout(2700);
  await expect(page.getByRole('button', { name: 'שלחו לעיבוד' })).toBeEnabled();
  await expect(page.locator('audio')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
});

test('leave an active upload, ignore its old socket events, and submit a new file', async ({ page }) => {
  await prepare(page);
  let sendStage: (jobId: string, message: string) => void = () => {};
  await page.routeWebSocket('**/socket.io/**', socket => {
    socket.send('0{"sid":"recovery-test","upgrades":[],"pingInterval":25000,"pingTimeout":20000}');
    socket.onMessage(message => {
      if (message === '40') socket.send('40{"sid":"recovery-test"}');
    });
    sendStage = (jobId, message) => socket.send(`42${JSON.stringify(['transcribe-status', { jobId, stage: 'correction', status: 'start', message }])}`);
  });
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = new Promise<void>(resolve => { releaseFirst = resolve; });
  const second = new Promise<void>(resolve => { releaseSecond = resolve; });
  let posts = 0;
  await page.route('**/api/transcribe', async route => {
    const index = ++posts;
    await (index === 1 ? first : second);
    await route.fulfill({ json: result }).catch(() => {});
  });
  await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: { status: 'processing' } }));
  await page.goto('/?screen=transcription');
  await chooseFile(page, 'first.wav');
  await page.getByRole('button', { name: 'שלחו לעיבוד' }).click();
  await expect.poll(() => posts).toBe(1);
  const firstId = await page.evaluate(key => localStorage.getItem(key), storageKey);
  await page.getByRole('button', { name: 'חזרה לבחירת קובץ' }).click();
  await expect(page.getByTestId('media-dropzone')).toBeVisible();
  await chooseFile(page);
  await page.getByRole('button', { name: 'שלחו לעיבוד' }).click();
  await expect.poll(() => posts).toBe(2);
  const secondId = await page.evaluate(key => localStorage.getItem(key), storageKey);
  expect(secondId).not.toBe(firstId);
  sendStage(secondId!, 'new-job-stage');
  await expect(page.getByText('new-job-stage')).toBeVisible();
  sendStage(firstId!, 'old-job-stage');
  releaseFirst();
  await expect(page.getByText('old-job-stage')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'מעבד...' })).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(secondId);
  releaseSecond();
  await expect(page.getByRole('button', { name: 'מעבד...' })).toHaveCount(0);
  await expect(page.getByTestId('media-dropzone')).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
});

test('a restored failed job shows its error and allows another file', async ({ page }) => {
  await prepare(page, true);
  await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: { status: 'failed', error: 'העיבוד נכשל' } }));
  await page.goto('/?screen=transcription');
  await expect(page.getByRole('alert').filter({ hasText: 'העיבוד נכשל' })).toBeVisible();
  await expect(page.getByTestId('media-dropzone')).toBeVisible();
  await chooseFile(page);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
});

for (const destination of ['היסטוריית סרטונים', 'דף הבית']) {
  test(`new video from ${destination} clears the completed upload`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await prepare(page);
    await page.route('**/api/transcribe', route => route.fulfill({ json: result }));
    await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: { status: 'processing' } }));
    await page.goto('/?screen=transcription');
    await chooseFile(page, 'first.wav');
    await page.getByRole('button', { name: 'שלחו לעיבוד' }).click();
    await expect(page.getByTestId('caption-track')).toBeVisible();
    await page.getByRole('button', { name: destination, exact: true }).click();
    // The last button is the list's call to action; the header has a separate button.
    await page.getByRole('button', { name: 'סרטון חדש', exact: true }).last().click();
    await expect(page).toHaveURL(/screen=transcription/);
    await expect(page.getByTestId('media-dropzone')).toBeVisible();
    await expect(page.getByTestId('caption-track')).toHaveCount(0);
    expect(await page.locator('input[type=file]').evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
    await chooseFile(page);
    await expect(page.getByRole('button', { name: 'שלחו לעיבוד' })).toBeEnabled();
  });
}

test('new video from the video list ignores a late completion of the previous job', async ({ page }) => {
  await prepare(page, true);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let polling = false;
  await page.route('**/api/transcribe/jobs/**', async route => {
    polling = true;
    await pending;
    await route.fulfill({ json: { status: 'completed', result } }).catch(() => {});
  });
  await page.goto('/?screen=videos');
  await expect.poll(() => polling).toBe(true);
  await page.getByRole('button', { name: 'סרטון חדש', exact: true }).last().click();
  await expect(page.getByTestId('media-dropzone')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  await chooseFile(page);
  release();
  await page.waitForTimeout(2700);
  await expect(page.getByRole('button', { name: 'שלחו לעיבוד' })).toBeEnabled();
  await expect(page.getByTestId('caption-track')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('media-dropzone')).toBeVisible();
});
