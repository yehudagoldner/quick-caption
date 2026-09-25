import "../src/loadAppEnv.js";
import { creditCapturedOrder, getUserCredits, getRecordedPayment } from "../db.js";
import { createPayPalClient, createPayPalRouter } from "../src/paypalCheckout.js";

const client = createPayPalClient({
  clientId: process.env.PAYPAL_CLIENT_ID,
  secret: process.env.PAYPAL_SECRET,
  baseUrl: process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com",
});

export default createPayPalRouter({ client, getUserCredits, creditCapturedOrder, getRecordedPayment });
