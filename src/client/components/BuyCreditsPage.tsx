import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Container, Stack, Typography } from "@mui/material";
import { PayPalScriptProvider, PayPalButtons, usePayPalScriptReducer, DISPATCH_ACTION, SCRIPT_LOADING_STATE } from "@paypal/react-paypal-js";
import { AccountBalanceWalletRounded } from "@mui/icons-material";
import type { AuthUser } from "../hooks/useTranscriptionWorkflow";

const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "").replace(/\/?$/, "");
type CreditPackage = { credits: number; priceUSD: string };
type PaymentConfig = { available?: boolean; clientId: string | null; packages: CreditPackage[] };
const paymentKey = (uid: string) => `quickcaption:pending-payment:${uid}`;
function readPending(uid?: string) {
  try { return uid ? localStorage.getItem(paymentKey(uid)) : null; } catch { return null; }
}
function savePending(uid: string, orderId: string | null) {
  try {
    if (orderId) localStorage.setItem(paymentKey(uid), orderId);
    else localStorage.removeItem(paymentKey(uid));
  } catch { /* The current page can still retry if browser storage is unavailable. */ }
}

function PaymentScriptStatus() {
  const [{ isPending, isRejected }, dispatch] = usePayPalScriptReducer();
  if (isPending) return <Typography role="status" textAlign="center">טוענים את PayPal...</Typography>;
  if (isRejected) return <Alert severity="error" action={<Button onClick={() => dispatch({ type: DISPATCH_ACTION.LOADING_STATUS, value: SCRIPT_LOADING_STATE.PENDING })}>נסו שוב</Button>}>לא ניתן לטעון את PayPal. בדקו את החיבור ונסו שוב.</Alert>;
  return null;
}

interface BuyCreditsPageProps {
  user: AuthUser;
  currentCredits: number | null;
  onCreditsUpdated: () => void;
}

export function BuyCreditsPage({ user, currentCredits, onCreditsUpdated }: BuyCreditsPageProps) {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [configLoading, setConfigLoading] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<string | null>(() => readPending(user?.uid));
  const [canDiscardPending, setCanDiscardPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const session = useRef(0);
  const captureFlight = useRef(false);

  useEffect(() => {
    session.current++;
    setPendingOrder(readPending(user?.uid));
    setCanDiscardPending(false);
    setSelectedPackage(null);
    setCheckoutOpen(false);
    setLoading(false);
    captureFlight.current = false;
    setError(null);
    setSuccess(null);
    return () => { session.current++; };
  }, [user?.uid]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    let active = true;
    setConfigLoading(true);
    fetch(`${API_BASE_URL}/api/payments/config`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json() as PaymentConfig;
        if (!Array.isArray(data.packages)) throw new Error();
        if (active) { setConfig(data); setError(null); }
      })
      .catch(() => { if (active) setError("לא ניתן לטעון את אפשרויות התשלום כרגע."); })
      .finally(() => { window.clearTimeout(timeout); if (active) setConfigLoading(false); });
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [configAttempt]);

  const handleCreateOrder = async (): Promise<string> => {
    if (!user || !selectedPackage || pendingOrder) throw new Error("יש לבחור חבילה ולהתחבר לחשבון.");
    const revision = session.current;
    const uid = user.uid;
    setError(null);
    setSuccess(null);
    setCheckoutOpen(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/payments/create-order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userUid: uid, credits: selectedPackage.credits }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json();
      if (!response.ok || typeof data.orderId !== "string") throw new Error(data.error || "לא ניתן ליצור הזמנה כרגע.");
      savePending(uid, data.orderId);
      if (session.current !== revision) throw new Error("החשבון השתנה. פתחו שוב את מסך הרכישה.");
      setPendingOrder(data.orderId);
      return data.orderId;
    } catch (err) {
      if (session.current === revision) { setCheckoutOpen(false); setError(err instanceof Error ? err.message : "לא ניתן ליצור הזמנה כרגע."); }
      throw err;
    }
  };

  const captureOrder = async (orderId: string) => {
    if (!user || captureFlight.current) return;
    const revision = session.current;
    const uid = user.uid;
    captureFlight.current = true;
    savePending(uid, orderId);
    setPendingOrder(orderId);
    setLoading(true);
    setError(null);
    setCanDiscardPending(false);
    try {
      const response = await fetch(`${API_BASE_URL}/api/payments/capture-order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, userUid: uid }), signal: AbortSignal.timeout(60_000),
      });
      const data = await response.json();
      if (session.current !== revision) return;
      if (!response.ok || data.success !== true) {
        setCanDiscardPending(data.code === "PAYMENT_NOT_APPROVED");
        throw new Error(data.error || "לא ניתן לאשר את הזיכוי כרגע. בדקו שוב את אותה הרכישה.");
      }
      savePending(uid, null);
      setPendingOrder(null);
      setSelectedPackage(null);
      setSuccess(data.creditsAdded > 0 ? `${data.creditsAdded} קרדיטים נוספו לחשבון. התשלום הושלם בהצלחה.` : "הרכישה כבר זוכתה בחשבון. לא בוצע זיכוי כפול.");
      onCreditsUpdated();
    } catch (err) {
      if (session.current === revision) setError(err instanceof Error && err.name !== "TimeoutError" && err.name !== "TypeError" ? err.message : "החיבור נקטע. בדקו שוב את הרכישה כדי לוודא שהקרדיטים נוספו.");
    } finally {
      if (session.current === revision) { captureFlight.current = false; setLoading(false); setCheckoutOpen(false); }
    }
  };

  const clearUnpaidOrder = () => {
    if (user) savePending(user.uid, null);
    setPendingOrder(null);
    setCanDiscardPending(false);
    setCheckoutOpen(false);
    setError(null);
  };
  const unavailable = config?.available === false || !config?.clientId;
  const locked = loading || checkoutOpen || Boolean(pendingOrder);
  // Package selection stays locked, but PayPal must remain interactive while the buyer approves.
  const showCheckout = Boolean(selectedPackage && config?.clientId && (!pendingOrder || checkoutOpen));

  return <Container maxWidth="md" dir="rtl" sx={{ px: { xs: 0, sm: 2 } }}>
    <Stack spacing={{ xs: 2, sm: 4 }}>
      <Box textAlign="center">
        <Typography variant="h3" sx={{ fontSize: { xs: "1.75rem", sm: "3rem" } }} gutterBottom>רכישת קרדיטים</Typography>
        <Typography color="text.secondary">בחרו חבילה ותשלמו דרך PayPal</Typography>
        {currentCredits !== null && <Chip icon={<AccountBalanceWalletRounded />} label={`יתרה נוכחית: ${currentCredits} קרדיטים`} color="primary" sx={{ mt: 2 }} />}
      </Box>
      {!user && <Alert severity="info">יש להתחבר לחשבון כדי לרכוש קרדיטים.</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}
      {configLoading && <Box role="status" textAlign="center"><CircularProgress size={28} aria-label="טעינת חבילות" /></Box>}
      {!configLoading && !config && <Button onClick={() => setConfigAttempt(attempt => attempt + 1)}>טעינת חבילות מחדש</Button>}
      {config && unavailable && <Alert severity="info">התשלום אינו זמין כרגע. נסו שוב מאוחר יותר.</Alert>}
      {pendingOrder && !checkoutOpen && <Card variant="outlined"><CardContent><Stack spacing={1.5}>
        <Typography fontWeight={600}>בדיקת רכישה קיימת</Typography>
        <Typography variant="body2">נשמרה רכישה שעדיין לא קיבלנו אישור על הזיכוי שלה. נבדוק את אותה הרכישה לפני התחלת תשלום נוסף.</Typography>
        <Typography variant="caption">מספר הזמנה: <bdi>{pendingOrder}</bdi></Typography>
        <Button variant="contained" disabled={loading} onClick={() => void captureOrder(pendingOrder)}>{loading ? "בודקים את הרכישה..." : "בדיקת הרכישה והשלמת הזיכוי"}</Button>
        {canDiscardPending && <Button onClick={clearUnpaidOrder}>חזרה לבחירת חבילה</Button>}
      </Stack></CardContent></Card>}
      <Box role="radiogroup" aria-label="חבילת קרדיטים" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 2 }}>
        {config?.packages.map(pkg => <Card key={pkg.credits} variant="outlined" sx={{ borderWidth: 2, borderColor: selectedPackage?.credits === pkg.credits ? "primary.main" : "divider" }}>
          <CardActionArea role="radio" aria-checked={selectedPackage?.credits === pkg.credits} aria-label={`${pkg.credits} קרדיטים ב־${pkg.priceUSD} דולר`} disabled={!user || locked || unavailable}
            onClick={() => { setSelectedPackage(pkg); setError(null); setSuccess(null); }}>
            <CardContent sx={{ textAlign: "center", py: { xs: 2, sm: 3 }, display: { xs: "flex", sm: "block" }, justifyContent: "space-between", alignItems: "center" }}>
              <Box><Typography variant="h4">{pkg.credits.toLocaleString()}</Typography><Typography color="text.secondary">קרדיטים</Typography></Box>
              <Box><Typography variant="h5" color="primary" dir="ltr">${pkg.priceUSD}</Typography><Typography variant="caption" color="text.secondary">${(Number(pkg.priceUSD) / pkg.credits).toFixed(2)} לקרדיט</Typography></Box>
            </CardContent>
          </CardActionArea>
        </Card>)}
      </Box>
      {showCheckout && selectedPackage && config?.clientId && <Card variant="outlined"><CardContent>
        <Typography variant="h6">סיכום הזמנה</Typography>
        <Typography sx={{ mb: 2 }}>{selectedPackage.credits} קרדיטים · <bdi>${selectedPackage.priceUSD} USD</bdi></Typography>
        <PayPalScriptProvider options={{ clientId: config.clientId, currency: "USD", intent: "capture" }}>
          <PaymentScriptStatus />
          <PayPalButtons style={{ layout: "vertical", label: "pay" }} forceReRender={[selectedPackage.credits, user?.uid]} disabled={loading || !user || unavailable}
            createOrder={handleCreateOrder} onApprove={data => captureOrder(data.orderID)}
            onCancel={clearUnpaidOrder}
            onError={() => { setCheckoutOpen(false); setError("אירעה שגיאה בחיבור ל־PayPal. אם התחלתם רכישה, בדקו את מצבה כאן."); }} />
        </PayPalScriptProvider>
        {loading && <Typography role="status" textAlign="center">מאשרים את התשלום ומעדכנים את היתרה...</Typography>}
      </CardContent></Card>}
    </Stack>
  </Container>;
}
