import express from "express";
import { CREDIT_PACKAGES, getCreditPackage } from "./creditPackages.js";

class PaymentError extends Error {
  constructor(message, status = 502, code = "PAYMENT_UNAVAILABLE") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createPayPalClient({ clientId, secret, baseUrl, fetchImpl = fetch }) {
  const available = Boolean(clientId && secret);
  async function request(path, options) {
    if (!available) throw new PaymentError("התשלום אינו זמין כרגע. נסו שוב מאוחר יותר.", 503);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (response.status === 404 && data.name === 'RESOURCE_NOT_FOUND' && /^\/v2\/checkout\/orders\/[A-Za-z0-9]+$/.test(path) && (!options.method || options.method === 'GET')) {
        throw new PaymentError('ההזמנה הקודמת אינה זמינה עוד ב־PayPal. אם לא חויבתם, אפשר להתחיל רכישה חדשה. אם חויבתם, שמרו את מספר ההזמנה ופנו אלינו לבדיקת הזיכוי.', 409, 'PAYMENT_ORDER_UNAVAILABLE');
      }
      if (!response.ok) throw new PaymentError("לא ניתן להשלים את הבדיקה מול PayPal כרגע. נסו שוב.");
      return data;
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      throw new PaymentError("החיבור ל־PayPal נקטע. אפשר לבדוק שוב את אותה הרכישה.");
    }
  }
  return {
    available,
    clientId: available ? clientId : null,
    async accessToken() {
      const data = await request('/v1/oauth2/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (!data.access_token) throw new PaymentError("לא ניתן להתחבר לשירות התשלום כרגע.");
      return data.access_token;
    },
    orderRequest(path, token, options = {}) {
      return request(`/v2/checkout/orders${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
      });
    },
  };
}

function verifyOrder(order, orderId, userUid) {
  const invalid = () => new PaymentError("פרטי ההזמנה אינם תואמים לרכישה.", 409, "PAYMENT_MISMATCH");
  if (order.id !== orderId || order.intent !== 'CAPTURE' || order.purchase_units?.length !== 1) throw invalid();
  const unit = order.purchase_units[0];
  let metadata;
  try { metadata = JSON.parse(unit.custom_id); } catch { throw invalid(); }
  const pkg = getCreditPackage(metadata?.credits);
  if (!pkg || metadata.userUid !== userUid || unit.amount?.currency_code !== 'USD' || unit.amount.value !== pkg.priceUSD) throw invalid();
  return pkg;
}

// Inject dependencies to exercise checkout without live charges or customer data.
export function createPayPalRouter({ client, getUserCredits, creditCapturedOrder, getRecordedPayment = async () => null }) {
  const router = express.Router();
  const failure = (res, error) => {
    const known = error instanceof PaymentError;
    res.status(known ? error.status : 503).json({
      error: known ? error.message : "לא ניתן לאשר את הזיכוי כרגע. בדקו שוב את אותה הרכישה.",
      code: known ? error.code : 'CREDIT_UPDATE_PENDING',
    });
  };
  router.get('/config', (_req, res) => {
    res.json({ available: client.available, clientId: client.clientId, packages: CREDIT_PACKAGES });
  });
  router.post('/create-order', async (req, res) => {
    const { userUid, credits } = req.body ?? {};
    const pkg = getCreditPackage(credits);
    if (typeof userUid !== 'string' || !userUid || userUid.length > 128 || !pkg) return res.status(400).json({ error: 'יש לבחור חבילה ולהתחבר לחשבון.' });
    try {
      if (await getUserCredits(userUid) === null) throw new PaymentError('יש להתחבר מחדש לפני הרכישה.', 404, 'USER_NOT_FOUND');
      const token = await client.accessToken();
      const order = await client.orderRequest('', token, {
        method: 'POST',
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: pkg.priceUSD }, description: `${pkg.credits} credits for QuickCaption`, custom_id: JSON.stringify({ userUid, credits: pkg.credits }) }],
          application_context: { brand_name: 'QuickCaption', locale: 'he-IL', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' },
        }),
      });
      if (!order.id) throw new PaymentError('לא ניתן ליצור הזמנה כרגע. נסו שוב.');
      res.json({ orderId: order.id });
    } catch (error) { failure(res, error); }
  });
  const reconcileOrder = (allowCapture) => async (req, res) => {
    const { orderId, userUid } = req.body ?? {};
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9]{10,64}$/.test(orderId) || typeof userUid !== 'string' || !userUid || userUid.length > 128) {
      return res.status(400).json({ error: 'פרטי הרכישה חסרים.' });
    }
    try {
      const balance = await getUserCredits(userUid);
      if (balance === null) throw new PaymentError('יש להתחבר מחדש כדי להשלים את הרכישה.', 404, 'USER_NOT_FOUND');
      // The local ledger is authoritative even after PayPal stops returning an old order.
      const recorded = await getRecordedPayment(orderId);
      if (recorded) {
        if (recorded.user_uid !== userUid) throw new PaymentError('פרטי ההזמנה אינם תואמים לרכישה.', 409, 'PAYMENT_MISMATCH');
        return res.json({ success: true, creditsAdded: 0, purchasedCredits: recorded.credits, newBalance: balance, transactionId: recorded.paypal_capture_id });
      }
      const token = await client.accessToken();
      let order = await client.orderRequest(`/${orderId}`, token);
      const pkg = verifyOrder(order, orderId, userUid);
      if (order.status === 'APPROVED') {
        if (!allowCapture) throw new PaymentError('הרכישה אושרה ב־PayPal אך טרם הושלמה. לחצו להשלמת התשלום והזיכוי.', 409, 'PAYMENT_APPROVED');
        try {
          await client.orderRequest(`/${orderId}/capture`, token, { method: 'POST', headers: { 'PayPal-Request-Id': `capture-${orderId}` } });
        } catch (error) {
          // A response can be lost after the buyer was charged. Reconcile this order.
          order = await client.orderRequest(`/${orderId}`, token);
          if (order.status !== 'COMPLETED') throw error;
        }
        order = await client.orderRequest(`/${orderId}`, token);
      }
      verifyOrder(order, orderId, userUid);
      if (['CREATED', 'SAVED', 'PAYER_ACTION_REQUIRED', 'VOIDED'].includes(order.status)) {
        throw new PaymentError('הרכישה עדיין לא אושרה ב־PayPal. אפשר לחזור לבחירת חבילה.', 409, 'PAYMENT_NOT_APPROVED');
      }
      const captures = order.purchase_units[0].payments?.captures;
      if (captures?.some(capture => capture.status === 'PENDING')) throw new PaymentError('התשלום ממתין לאישור PayPal. בדקו שוב בעוד כמה דקות.', 409, 'PAYMENT_PENDING');
      if (captures?.length === 1 && ['DECLINED', 'DENIED'].includes(captures[0].status)) throw new PaymentError('התשלום נדחה ולא הושלם. אפשר לבחור חבילה ולנסות שוב.', 409, 'PAYMENT_NOT_APPROVED');
      if (order.status !== 'COMPLETED' || captures?.length !== 1 || captures[0].status !== 'COMPLETED' || !captures[0].id || captures[0].amount?.currency_code !== 'USD' || captures[0].amount.value !== pkg.priceUSD) {
        throw new PaymentError('התשלום טרם אומת. בדקו שוב את הרכישה לפני תשלום נוסף.', 409, 'PAYMENT_UNVERIFIED');
      }
      const { credited, newBalance } = await creditCapturedOrder({ orderId, captureId: captures[0].id, userUid, credits: pkg.credits, amountUSD: pkg.priceUSD });
      res.json({ success: true, creditsAdded: credited ? pkg.credits : 0, purchasedCredits: pkg.credits, newBalance, transactionId: captures[0].id });
    } catch (error) { failure(res, error); }
  };
  // Page recovery checks existing payments, but never initiates a charge on page load.
  router.post('/check-order', reconcileOrder(false));
  router.post('/capture-order', reconcileOrder(true));
  return router;
}
