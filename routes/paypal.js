import express from "express";
import fetch from "node-fetch";
import "../src/loadAppEnv.js";
import { addCredits, getUserCredits } from "../db.js";

const router = express.Router();

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com"; // Use sandbox for testing

if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
  throw new Error("PayPal credentials are missing. Please set PAYPAL_CLIENT_ID and PAYPAL_SECRET in your environment.");
}

/**
 * Get PayPal access token
 */
async function getPayPalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64");

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${auth}`,
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to get PayPal access token: ${data.error_description || data.error}`);
  }

  return data.access_token;
}

/**
 * Create PayPal order
 * POST /api/payments/create-order
 */
router.post("/create-order", async (req, res) => {
  const { userUid, credits, amount, currency = "USD" } = req.body;

  if (!userUid || !credits || !amount) {
    return res.status(400).json({ error: "userUid, credits, and amount are required" });
  }

  try {
    const accessToken = await getPayPalAccessToken();

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currency,
            value: amount,
          },
          description: `${credits} credits for QuickCaption`,
          custom_id: JSON.stringify({ userUid, credits }),
        },
      ],
      application_context: {
        brand_name: "QuickCaption",
        user_action: "PAY_NOW",
      },
    };

    const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(orderPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("PayPal order creation failed:", data);
      return res.status(response.status).json({ error: data.message || "Failed to create order" });
    }

    res.json({ orderId: data.id });
  } catch (error) {
    console.error("Error creating PayPal order:", error);
    res.status(500).json({ error: error.message || "Failed to create order" });
  }
});

/**
 * Capture PayPal order and add credits
 * POST /api/payments/capture-order
 */
router.post("/capture-order", async (req, res) => {
  const { orderId, userUid, credits } = req.body;

  if (!orderId || !userUid || !credits) {
    return res.status(400).json({ error: "orderId, userUid, and credits are required" });
  }

  try {
    const accessToken = await getPayPalAccessToken();

    // Capture the order
    const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("PayPal order capture failed:", data);
      return res.status(response.status).json({ error: data.message || "Failed to capture order" });
    }

    // Verify payment was successful
    if (data.status !== "COMPLETED") {
      console.error("PayPal order not completed:", data.status);
      return res.status(400).json({ error: "Payment not completed" });
    }

    // Add credits to user account
    const newBalance = await addCredits(userUid, credits);

    if (newBalance === null) {
      console.error("Failed to add credits: user not found");
      return res.status(404).json({ error: "User not found" });
    }

    console.log(`Added ${credits} credits to user ${userUid}. New balance: ${newBalance}`);

    res.json({
      success: true,
      creditsAdded: credits,
      newBalance,
      transactionId: data.id,
    });
  } catch (error) {
    console.error("Error capturing PayPal order:", error);
    res.status(500).json({ error: error.message || "Failed to capture payment" });
  }
});

export default router;
