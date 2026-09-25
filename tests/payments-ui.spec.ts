import { test, expect } from '@playwright/test';
import { mockPayPal, prepareApp, testUid } from './app-fixtures';

const config = { available: true, clientId: 'test-client', packages: [{ credits: 100, priceUSD: '5.00' }, { credits: 500, priceUSD: '20.00' }, { credits: 1000, priceUSD: '30.00' }] };
const storageKey = `quickcaption:pending-payment:${testUid}`;

test('the open PayPal form remains interactive until buyer approval', async ({ page }) => {
  await prepareApp(page);
  await mockPayPal(page, { deferApproval: true });
  await page.route('**/api/payments/config', route => route.fulfill({ json: config }));
  await page.route('**/api/payments/create-order', route => route.fulfill({ json: { orderId: 'ORDER123456789' } }));
  let captured = 0;
  await page.route('**/api/payments/capture-order', async route => {
    captured++;
    await route.fulfill({ json: { success: true, creditsAdded: 100, newBalance: 150 } });
  });
  await page.goto('/?screen=buy-credits');
  await page.getByRole('radio').first().click();
  await page.getByRole('button', { name: 'PayPal test checkout' }).click();
  const approve = page.getByRole('button', { name: 'PayPal test approve' });
  await expect(approve).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  await expect(approve).toBeEnabled();
  await expect(page.locator('.paypal-buttons-disabled')).toHaveCount(0);
  expect(captured).toBe(0);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('ORDER123456789');
  await approve.click();
  await expect(page.getByText('התשלום הושלם בהצלחה.', { exact: false })).toBeVisible();
  expect(captured).toBe(1);
});

test('an unapproved checkout unlocks packages automatically', async ({ page }) => {
  await prepareApp(page);
  await mockPayPal(page);
  await page.route('**/api/payments/config', route => route.fulfill({ json: config }));
  await page.route('**/api/payments/create-order', route => route.fulfill({ json: { orderId: 'ORDER123456789' } }));
  await page.route('**/api/payments/capture-order', route => route.fulfill({ status: 409, json: { code: 'PAYMENT_NOT_APPROVED', error: 'הרכישה עדיין לא אושרה ב־PayPal.' } }));
  await page.goto('/?screen=buy-credits');
  await page.getByRole('radio').first().click();
  await page.getByRole('button', { name: 'PayPal test checkout' }).click();
  await expect(page.getByText('הרכישה הקודמת לא הושלמה.', { exact: false })).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeEnabled();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
});
test('checkout uses the selected package, locks selection, and recovers a lost response after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);
  await mockPayPal(page);
  await page.route('**/api/payments/config', route => route.fulfill({ json: config }));
  let created = 0;
  let captured = 0;
  await page.route('**/api/payments/create-order', route => {
    created++;
    expect(route.request().postDataJSON()).toEqual({ userUid: testUid, credits: 500 });
    return route.fulfill({ json: { orderId: 'ORDER123456789' } });
  });
  await page.route('**/api/payments/capture-order', route => {
    captured++;
    expect(route.request().postDataJSON().orderId).toBe('ORDER123456789');
    return captured === 1 ? route.abort('failed') : route.fulfill({ json: { success: true, creditsAdded: 0, purchasedCredits: 500, newBalance: 550 } });
  });
  let checked = 0;
  await page.route('**/api/payments/check-order', route => {
    checked++;
    expect(route.request().postDataJSON().orderId).toBe('ORDER123456789');
    return route.fulfill({ json: { success: true, creditsAdded: 0, purchasedCredits: 500, newBalance: 550 } });
  });
  await page.goto('/?screen=buy-credits');
  await page.getByRole('radio', { name: '100 קרדיטים ב־5.00 דולר', exact: true }).click();
  await page.getByRole('radio', { name: '500 קרדיטים ב־20.00 דולר', exact: true }).click();
  await page.getByRole('button', { name: 'PayPal test checkout' }).click();
  await expect(page.getByText('בדיקת רכישה קיימת', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('ORDER123456789');
  await page.reload();
  await expect(page.getByText('הרכישה כבר זוכתה בחשבון.', { exact: false })).toBeVisible();
  expect(created).toBe(1);
  expect(captured).toBe(1);
  expect(checked).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  await expect(page.getByRole('radio').first()).toBeEnabled();
  await page.screenshot({ path: 'tmp/review/payment-success.png' });
});

test('configuration failure offers retry; unpaid saved order clears automatically', async ({ page }) => {
  await prepareApp(page);
  let attempts = 0;
  await page.route('**/api/payments/config', route => route.fulfill(++attempts === 1 ? { status: 503, json: {} } : { json: config }));
  await page.addInitScript(key => localStorage.setItem(key, 'ORDER123456789'), storageKey);
  await page.route('**/api/payments/check-order', route => route.fulfill({ status: 409, json: { code: 'PAYMENT_NOT_APPROVED', error: 'הרכישה לא אושרה' } }));
  await page.goto('/?screen=buy-credits');
  await page.getByRole('button', { name: 'טעינת חבילות מחדש' }).click();
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('radio').first()).toBeEnabled();
});

test('missing old PayPal order offers an exit and preserves the reference', async ({ page }) => {
  await prepareApp(page);
  await mockPayPal(page);
  await page.route('**/api/payments/config', route => route.fulfill({ json: config }));
  await page.addInitScript(key => localStorage.setItem(key, 'ORDER123456789'), storageKey);
  await page.route('**/api/payments/check-order', route => route.fulfill({ status: 409, json: { code: 'PAYMENT_ORDER_UNAVAILABLE', error: 'ההזמנה הקודמת אינה זמינה עוד ב־PayPal.' } }));
  await page.goto('/?screen=buy-credits');
  await page.getByRole('button', { name: 'חזרה לבחירת חבילה' }).click();
  await expect(page.getByRole('radio').first()).toBeEnabled();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  expect(await page.evaluate(key => localStorage.getItem(key), `quickcaption:unresolved-payment:${testUid}:ORDER123456789`)).toBe('ORDER123456789');
  await page.getByRole('radio').first().click();
  await expect(page.getByRole('button', { name: 'PayPal test checkout' })).toBeEnabled();
});

for (const code of ['PAYMENT_PENDING', 'PAYMENT_UNAVAILABLE', 'PAYMENT_APPROVED']) {
  test(`${code} retains recovery and does not automatically start a charge`, async ({ page }) => {
    await prepareApp(page);
    await page.route('**/api/payments/config', route => route.fulfill({ json: config }));
    await page.addInitScript(key => localStorage.setItem(key, 'ORDER123456789'), storageKey);
    await page.route('**/api/payments/check-order', route => route.fulfill({ status: 409, json: { code, error: 'בדיקת מצב התשלום' } }));
    let captures = 0;
    await page.route('**/api/payments/capture-order', route => { captures++; return route.abort(); });
    await page.goto('/?screen=buy-credits');
    await expect(page.getByText('בדיקת מצב התשלום', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio').first()).toBeDisabled();
    await expect(page.getByRole('button', { name: 'חזרה לבחירת חבילה' })).toHaveCount(0);
    expect(captures).toBe(0);
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('ORDER123456789');
  });
}

test('PayPal script loading failure can be retried without reloading the page', async ({ page }) => {
  await prepareApp(page);
  await mockPayPal(page);
  await page.route('**/api/payments/config', route => route.fulfill({ json: config }));
  let scriptAttempts = 0;
  await page.route('https://www.paypal.com/sdk/js?**', route => ++scriptAttempts === 1 ? route.abort('failed') : route.fallback());
  await page.goto('/?screen=buy-credits');
  await page.getByRole('radio').first().click();
  await expect(page.getByText('לא ניתן לטעון את PayPal.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'נסו שוב', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PayPal test checkout' })).toBeVisible();
});
