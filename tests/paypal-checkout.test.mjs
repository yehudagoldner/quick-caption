import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPayPalClient, createPayPalRouter } from '../src/paypalCheckout.js';
import { CREDIT_PACKAGES } from '../src/creditPackages.js';

const orderId = 'ORDER123456789';
function order(status = 'APPROVED', credits = 100, price = '5.00') {
  return { id: orderId, intent: 'CAPTURE', status, purchase_units: [{ custom_id: JSON.stringify({ userUid: 'buyer', credits }), amount: { currency_code: 'USD', value: price },
    ...(status === 'COMPLETED' ? { payments: { captures: [{ id: 'CAPTURE123456', status: 'COMPLETED', amount: { currency_code: 'USD', value: price } }] } } : {}) }] };
}

async function fixture(t, { payment = order(), lostCapture = false, creditFailure = false, lookupStatus = 200, recorded = null } = {}) {
  const requests = [];
  const ledger = new Map();
  let balance = 50;
  const client = createPayPalClient({ clientId: 'test', secret: 'test', baseUrl: 'https://paypal.invalid', fetchImpl: async (url, options) => {
    requests.push({ url, ...options });
    assert.ok(options.signal, 'Every remote request has a timeout');
    if (url.endsWith('/token')) return Response.json({ access_token: 'token' });
    if (url.endsWith('/capture')) {
      payment = order('COMPLETED');
      if (lostCapture) throw new TypeError('Network disconnected after capture');
      return Response.json(payment);
    }
    if (options.method === 'POST') return Response.json({ id: orderId });
    return Response.json(lookupStatus === 404 ? { name: 'RESOURCE_NOT_FOUND' } : lookupStatus === 503 ? { name: 'SERVICE_UNAVAILABLE' } : payment, { status: lookupStatus });
  } });
  const app = express();
  app.use(express.json());
  app.use(createPayPalRouter({ client, getUserCredits: async uid => uid === 'buyer' ? balance : null,
    getRecordedPayment: async () => recorded,
    creditCapturedOrder: async data => {
      if (creditFailure) { creditFailure = false; throw new Error('Database unavailable'); }
      const credited = !ledger.has(data.orderId);
      if (credited) { ledger.set(data.orderId, data); balance += data.credits; }
      return { credited, newBalance: balance };
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { post, requests, ledger, base };
}

test('all packages use server prices even when the browser supplies a fake amount', async t => {
  const f = await fixture(t);
  for (const pkg of CREDIT_PACKAGES) {
    const result = await f.post('/create-order', { userUid: 'buyer', credits: pkg.credits, amount: '0.01', currency: 'ILS' });
    assert.equal(result.status, 200);
    const payload = JSON.parse(f.requests.at(-1).body);
    assert.deepEqual(payload.purchase_units[0].amount, { currency_code: 'USD', value: pkg.priceUSD });
    assert.equal(payload.application_context.locale, 'he-IL', 'Orders API requires a BCP 47 locale, unlike the SDK script parameter');
  }
  assert.equal((await f.post('/create-order', { userUid: 'buyer', credits: 999999 })).status, 400);
  assert.equal((await f.post('/create-order', { userUid: 'unknown', credits: 100 })).status, 404);
});

test('approved checkout completes and replays without a second capture or credit', async t => {
  const f = await fixture(t);
  const first = await f.post('/capture-order', { orderId, userUid: 'buyer' });
  assert.equal(first.data.newBalance, 150);
  assert.equal(first.data.creditsAdded, 100);
  const second = await f.post('/capture-order', { orderId, userUid: 'buyer' });
  assert.equal(second.data.newBalance, 150);
  assert.equal(second.data.creditsAdded, 0);
  const captures = f.requests.filter(r => r.url.endsWith('/capture'));
  assert.equal(captures.length, 1);
  assert.equal(captures[0].headers['PayPal-Request-Id'], `capture-${orderId}`);
});

test('lost capture response is reconciled against the same order', async t => {
  const f = await fixture(t, { lostCapture: true });
  const result = await f.post('/capture-order', { orderId, userUid: 'buyer' });
  assert.equal(result.status, 200);
  assert.equal(result.data.newBalance, 150);
});

test('database failure after payment can be retried without another charge', async t => {
  const f = await fixture(t, { creditFailure: true });
  assert.equal((await f.post('/capture-order', { orderId, userUid: 'buyer' })).data.code, 'CREDIT_UPDATE_PENDING');
  assert.equal((await f.post('/capture-order', { orderId, userUid: 'buyer' })).data.newBalance, 150);
  assert.equal(f.requests.filter(r => r.url.endsWith('/capture')).length, 1);
});

for (const scenario of ['wrong owner', 'wrong price', 'pending', 'unapproved', 'wrong captured currency']) {
  test(`no credits are issued for ${scenario}`, async t => {
    const payment = order('COMPLETED');
    if (scenario === 'wrong owner') payment.purchase_units[0].custom_id = JSON.stringify({ userUid: 'someone-else', credits: 100 });
    if (scenario === 'wrong price') payment.purchase_units[0].amount.value = '0.01';
    if (scenario === 'pending') payment.purchase_units[0].payments.captures[0].status = 'PENDING';
    if (scenario === 'unapproved') payment.status = 'CREATED';
    if (scenario === 'wrong captured currency') payment.purchase_units[0].payments.captures[0].amount.currency_code = 'EUR';
    const f = await fixture(t, { payment });
    const result = await f.post('/capture-order', { orderId, userUid: 'buyer' });
    assert.equal(result.status, 409);
    assert.equal(f.ledger.size, 0);
  });
}

test('missing payment credentials does not prevent the application from starting', async () => {
  const client = createPayPalClient({ baseUrl: 'https://paypal.invalid', fetchImpl: () => { throw new Error('Should not contact PayPal'); } });
  assert.equal(client.available, false);
  await assert.rejects(client.accessToken(), error => error.status === 503);
});

test('checking an approved order never initiates a capture', async t => {
  const f = await fixture(t);
  const result = await f.post('/check-order', { orderId, userUid: 'buyer' });
  assert.equal(result.data.code, 'PAYMENT_APPROVED');
  assert.equal(f.requests.filter(r => r.url.endsWith('/capture')).length, 0);
  assert.equal(f.ledger.size, 0);
});

test('checking a completed payment restores credit idempotently without capture', async t => {
  const f = await fixture(t, { payment: order('COMPLETED') });
  assert.equal((await f.post('/check-order', { orderId, userUid: 'buyer' })).data.creditsAdded, 100);
  assert.equal((await f.post('/check-order', { orderId, userUid: 'buyer' })).data.creditsAdded, 0);
  assert.equal(f.requests.filter(r => r.url.endsWith('/capture')).length, 0);
});

test('recorded payment recovers even when PayPal no longer returns the order', async t => {
  const f = await fixture(t, { lookupStatus: 404, recorded: { user_uid: 'buyer', credits: 100, paypal_capture_id: 'CAPTURE123456' } });
  const result = await f.post('/check-order', { orderId, userUid: 'buyer' });
  assert.equal(result.data.success, true);
  assert.equal(result.data.creditsAdded, 0);
  assert.equal(f.requests.length, 0);
});

test('recorded payment cannot be recovered by another user', async t => {
  const f = await fixture(t, { recorded: { user_uid: 'someone-else', credits: 100 } });
  assert.equal((await f.post('/check-order', { orderId, userUid: 'buyer' })).data.code, 'PAYMENT_MISMATCH');
  assert.equal(f.requests.length, 0);
});

for (const [status, code] of [[404, 'PAYMENT_ORDER_UNAVAILABLE'], [503, 'PAYMENT_UNAVAILABLE']]) {
  test(`order lookup HTTP ${status} is classified without pretending it was paid or unpaid`, async t => {
    const f = await fixture(t, { lookupStatus: status });
    assert.equal((await f.post('/check-order', { orderId, userUid: 'buyer' })).data.code, code);
    assert.equal(f.ledger.size, 0);
  });
}

for (const state of ['CREATED', 'VOIDED', 'PAYER_ACTION_REQUIRED', 'DECLINED', 'PENDING']) {
  test(`recovery classifies ${state} without charging`, async t => {
    const payment = order(['DECLINED', 'PENDING'].includes(state) ? 'COMPLETED' : state);
    if (['DECLINED', 'PENDING'].includes(state)) payment.purchase_units[0].payments.captures[0].status = state;
    const f = await fixture(t, { payment });
    assert.equal((await f.post('/check-order', { orderId, userUid: 'buyer' })).data.code, state === 'PENDING' ? 'PAYMENT_PENDING' : 'PAYMENT_NOT_APPROVED');
    assert.equal(f.requests.filter(r => r.url.endsWith('/capture')).length, 0);
  });
}
