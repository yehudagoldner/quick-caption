import { test, expect } from '@playwright/test';
import { mockPayPal, prepareApp, testUid } from './app-fixtures';

const config = { available: true, clientId: 'test-client', packages: [{ credits: 100, priceUSD: '5.00' }, { credits: 500, priceUSD: '20.00' }, { credits: 1000, priceUSD: '30.00' }] };
const storageKey = `quickcaption:pending-payment:${testUid}`;
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
  await page.goto('/?screen=buy-credits');
  await page.getByRole('radio', { name: '100 קרדיטים ב־5.00 דולר', exact: true }).click();
  await page.getByRole('radio', { name: '500 קרדיטים ב־20.00 דולר', exact: true }).click();
  await page.getByRole('button', { name: 'PayPal test checkout' }).click();
  await expect(page.getByText('בדיקת רכישה קיימת', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('ORDER123456789');
  await page.reload();
  await page.getByRole('button', { name: 'בדיקת הרכישה והשלמת הזיכוי' }).click();
  await expect(page.getByText('הרכישה כבר זוכתה בחשבון.', { exact: false })).toBeVisible();
  expect(created).toBe(1);
  expect(captured).toBe(2);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  await expect(page.getByRole('radio').first()).toBeEnabled();
  await page.screenshot({ path: 'tmp/review/payment-success.png' });
});

test('configuration failure offers retry; unpaid recovered order can be dismissed', async ({ page }) => {
  await prepareApp(page);
  let attempts = 0;
  await page.route('**/api/payments/config', route => route.fulfill(++attempts === 1 ? { status: 503, json: {} } : { json: config }));
  await page.addInitScript(key => localStorage.setItem(key, 'ORDER123456789'), storageKey);
  await page.route('**/api/payments/capture-order', route => route.fulfill({ status: 409, json: { code: 'PAYMENT_NOT_APPROVED', error: 'הרכישה לא אושרה' } }));
  await page.goto('/?screen=buy-credits');
  await page.getByRole('button', { name: 'טעינת חבילות מחדש' }).click();
  await expect(page.getByRole('radio')).toHaveCount(3);
  await page.getByRole('button', { name: 'בדיקת הרכישה והשלמת הזיכוי' }).click();
  await page.getByRole('button', { name: 'חזרה לבחירת חבילה' }).click();
  await expect(page.getByRole('radio').first()).toBeEnabled();
});

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
