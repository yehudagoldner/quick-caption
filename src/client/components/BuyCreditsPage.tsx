import { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Container,
  Stack,
  Chip,
} from "@mui/material";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { AccountBalanceWalletRounded, CheckCircleRounded } from "@mui/icons-material";
import type { AuthUser } from "../hooks/useTranscriptionWorkflow";

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
const API_BASE_URL = RAW_API_BASE.replace(/\/?$/, "");

const PAYPAL_CLIENT_ID = "AdwBUYGcx87z5DHZla4elO52n42osNIK_obh7uZAVLkNmeVhaLGpv6uMrKWpbRvz7aPG_NdGFj-LWhCE";

// Credit packages: 10 ILS = 100 credits
const CREDIT_PACKAGES = [
  { credits: 100, price: 10, priceUSD: 2.78, popular: false },
  { credits: 500, price: 50, priceUSD: 13.89, popular: true },
  { credits: 1000, price: 100, priceUSD: 27.78, popular: false },
];

interface BuyCreditsPageProps {
  user: AuthUser;
  currentCredits: number | null;
  onCreditsUpdated: () => void;
}

export function BuyCreditsPage({ user, currentCredits, onCreditsUpdated }: BuyCreditsPageProps) {
  const [selectedPackage, setSelectedPackage] = useState<typeof CREDIT_PACKAGES[0] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleCreateOrder = async () => {
    if (!selectedPackage) return;

    try {
      const response = await fetch(`${API_BASE_URL || ""}/api/payments/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userUid: user?.uid,
          credits: selectedPackage.credits,
          amount: selectedPackage.priceUSD.toFixed(2),
          currency: "USD",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create order");
      }

      return data.orderId;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
      throw err;
    }
  };

  const handleApprove = async (data: any) => {
    if (!selectedPackage) return;

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL || ""}/api/payments/capture-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: data.orderID,
          userUid: user?.uid,
          credits: selectedPackage.credits,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to capture payment");
      }

      setSuccess(true);
      setError(null);
      onCreditsUpdated();

      // Reset after 3 seconds
      setTimeout(() => {
        setSuccess(false);
        setSelectedPackage(null);
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md">
      <Stack spacing={4}>
        <Box sx={{ textAlign: "center" }}>
          <Typography variant="h3" gutterBottom>
            רכישת קרדיטים
          </Typography>
          <Typography variant="body1" color="text.secondary">
            בחר חבילת קרדיטים ושלם בקלות דרך PayPal
          </Typography>
          {currentCredits !== null && (
            <Chip
              icon={<AccountBalanceWalletRounded />}
              label={`יתרה נוכחית: ${currentCredits} קרדיטים`}
              color="primary"
              sx={{ mt: 2 }}
            />
          )}
        </Box>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" icon={<CheckCircleRounded />}>
            התשלום בוצע בהצלחה! הקרדיטים נוספו לחשבונך.
          </Alert>
        )}

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 3 }}>
          {CREDIT_PACKAGES.map((pkg) => (
            <Card
              key={pkg.credits}
              sx={{
                position: "relative",
                border: selectedPackage?.credits === pkg.credits ? 3 : 1,
                borderColor: selectedPackage?.credits === pkg.credits ? "primary.main" : "divider",
                cursor: "pointer",
                transition: "all 0.2s",
                "&:hover": {
                  transform: "translateY(-4px)",
                  boxShadow: 4,
                },
              }}
              onClick={() => setSelectedPackage(pkg)}
            >
              {pkg.popular && (
                <Chip
                  label="פופולרי"
                  color="secondary"
                  size="small"
                  sx={{ position: "absolute", top: 12, left: 12 }}
                />
              )}
              <CardContent sx={{ textAlign: "center", py: 4 }}>
                <Typography variant="h4" gutterBottom>
                  {pkg.credits}
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  קרדיטים
                </Typography>
                <Typography variant="h5" color="primary" sx={{ mt: 2 }}>
                  ₪{pkg.price}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  (${pkg.priceUSD.toFixed(2)} USD)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  ₪{(pkg.price / pkg.credits).toFixed(2)} לקרדיט
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Box>

        {selectedPackage && (
          <Card sx={{ bgcolor: "primary.50" }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                סיכום הזמנה
              </Typography>
              <Stack spacing={1}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography>קרדיטים:</Typography>
                  <Typography fontWeight="bold">{selectedPackage.credits}</Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography>מחיר:</Typography>
                  <Typography fontWeight="bold">
                    ₪{selectedPackage.price} (${selectedPackage.priceUSD.toFixed(2)} USD)
                  </Typography>
                </Box>
              </Stack>

              <Box sx={{ mt: 3 }}>
                {loading ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
                    <CircularProgress />
                  </Box>
                ) : (
                  <PayPalScriptProvider
                    options={{
                      clientId: PAYPAL_CLIENT_ID,
                      currency: "USD",
                    }}
                  >
                    <PayPalButtons
                      style={{ layout: "vertical", label: "pay" }}
                      createOrder={handleCreateOrder}
                      onApprove={handleApprove}
                      onError={(err) => {
                        console.error("PayPal error:", err);
                        setError("אירעה שגיאה בתשלום. נסה שוב.");
                      }}
                    />
                  </PayPalScriptProvider>
                )}
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2, textAlign: "center" }}>
                תשלום מאובטח באמצעות PayPal
              </Typography>
            </CardContent>
          </Card>
        )}

        <Box sx={{ textAlign: "center", py: 2 }}>
          <Typography variant="body2" color="text.secondary">
            100 קרדיטים = $1 | מחירים בדולרים בעת התשלום
          </Typography>
        </Box>
      </Stack>
    </Container>
  );
}
