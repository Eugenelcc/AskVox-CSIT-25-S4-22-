import { useMemo, useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X, CheckCircle2 } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { Elements, CardNumberElement, CardExpiryElement, CardCvcElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { stripePromise } from "../../stripe";

import AskVoxLogo from "../../components/TopBars/AskVox.png";
import AskVoxStarBackground from "../../components/background/background";
import styles from "./payment.module.css";
import PaymentImage from "./card_stack.png";

const PAYMENT_IMAGE = PaymentImage;

type BillingCycle = "monthly" | "yearly";
type Brand = "visa" | "mastercard" | "amex" | "unknown";

/* -------------------- brand icons (no PNG needed) -------------------- */
function CardBrandIcon({ brand }: { brand: Brand }) {
  if (brand === "mastercard") {
    return (
      <svg width="36" height="24" viewBox="0 0 36 24" aria-label="Mastercard" role="img">
        <circle cx="14" cy="12" r="8" fill="#EB001B" />
        <circle cx="22" cy="12" r="8" fill="#F79E1B" fillOpacity="0.95" />
      </svg>
    );
  }

  if (brand === "visa") {
    return (
      <svg width="36" height="24" viewBox="0 0 36 24" aria-label="Visa" role="img">
        <rect x="0" y="0" width="36" height="24" rx="7" fill="#1A1F71" />
        <text
          x="18"
          y="16"
          textAnchor="middle"
          fontSize="10"
          fill="#fff"
          fontFamily="system-ui"
          fontWeight="700"
          letterSpacing="1"
        >
          VISA
        </text>
      </svg>
    );
  }

  if (brand === "amex") {
    return (
      <svg width="36" height="24" viewBox="0 0 36 24" aria-label="American Express" role="img">
        <rect x="0" y="0" width="36" height="24" rx="7" fill="#2E77BB" />
        <text
          x="18"
          y="16"
          textAnchor="middle"
          fontSize="9"
          fill="#fff"
          fontFamily="system-ui"
          fontWeight="700"
          letterSpacing="0.6"
        >
          AMEX
        </text>
      </svg>
    );
  }

  return null; // ✅ don't show "CARD"
}

  // Inner checkout form using the same working pattern as settings
  function CheckoutCardForm({ amount, cycle, subscriptionType, onSuccess, setError }: { amount: number; cycle: BillingCycle | undefined; subscriptionType: string; onSuccess: () => void; setError: (s: string | null) => void }) {
    const stripe = useStripe();
    const elements = useElements();
    const [name, setName] = useState("");
    const [numOk, setNumOk] = useState(false);
    const [expOk, setExpOk] = useState(false);
    const [cvcOk, setCvcOk] = useState(false);
    const [busy, setBusy] = useState(false);
    const [brand, setBrand] = useState<Brand>("unknown");

    const submit = async () => {
      if (!stripe || !elements) return;
      setBusy(true); setError(null);
      try {
        const cardEl = elements.getElement(CardNumberElement);
        if (!cardEl) throw new Error("Card element not ready");
        const pmRes = await stripe.createPaymentMethod({ type: "card", card: cardEl, billing_details: { name: name.trim() || undefined } });
        if (pmRes.error || !pmRes.paymentMethod?.id) throw new Error(pmRes.error?.message || "Failed to create PaymentMethod");
        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token as string | undefined;
        if (!token) throw new Error("Not authenticated");
        const body = { plan_type: cycle ?? "monthly", subscription_type: subscriptionType, amount, payment_method_id: pmRes.paymentMethod.id };
        const resp = await fetch(`${import.meta.env.VITE_API_URL}/billing/checkout`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
        if (!resp.ok) throw new Error(await resp.text());
        onSuccess();
      } catch (e: any) {
        setError(e?.message || "Payment failed. Please try again.");
      } finally {
        setBusy(false);
      }
    };

    return (
      <>
        {/* Card number with dynamic brand icon */}
        <div className={styles.cardInputWrap}>
          <div className={styles.input} style={{ padding: 12 }}>
            <CardNumberElement
              onChange={(e: any) => { setNumOk(!!e.complete); const b = (e.brand || "unknown").toString().toLowerCase(); const m: Record<string, Brand> = { visa: "visa", mastercard: "mastercard", amex: "amex" }; setBrand(m[b] || "unknown"); }}
              options={{ disableLink: true, style: { base: { color: "#fff", fontSize: "16px", lineHeight: "28px", fontFamily: '"ABeeZee", system-ui, sans-serif', "::placeholder": { color: "rgba(255,255,255,0.55)" } } }} }
            />
          </div>
          <div className={styles.brandIcon}>
            {brand !== "unknown" ? <CardBrandIcon brand={brand} /> : null}
          </div>
        </div>

        {/* Card holder name */}
        <label className={styles.label}>Card Holder Name</label>
        <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your Full name..." autoComplete="cc-name" />

        {/* Expiry + CVC row */}
        <div className={styles.row}>
          <div className={styles.col}>
            <label className={styles.label}>Expiry Date: *</label>
            <div className={styles.inputSmall} style={{ padding: 12 }}>
              <CardExpiryElement onChange={(e) => setExpOk(!!e.complete)} options={{ style: { base: { color: "#fff", fontSize: "16px", lineHeight: "28px", fontFamily: '"ABeeZee", system-ui, sans-serif', "::placeholder": { color: "rgba(255,255,255,0.55)" } } } }} />
            </div>
          </div>
          <div className={styles.col}>
            <label className={styles.label}>CVV/CVV2: *</label>
            <div className={styles.inputSmall} style={{ padding: 12 }}>
              <CardCvcElement onChange={(e) => setCvcOk(!!e.complete)} options={{ style: { base: { color: "#fff", fontSize: "16px", lineHeight: "28px", fontFamily: '"ABeeZee", system-ui, sans-serif', "::placeholder": { color: "rgba(255,255,255,0.55)" } } } }} />
            </div>
          </div>
        </div>

        <button className={`${styles.payBtn} ${(!(numOk && expOk && cvcOk && name.trim().length >= 2) || busy) ? styles.payBtnDisabled : ""}`} onClick={submit} disabled={!(numOk && expOk && cvcOk && name.trim().length >= 2) || busy}>
          {busy ? "Processing..." : `Pay $${amount}`}
        </button>
      </>
    );
  }

/* -------------------- component -------------------- */
export default function Payment() {
  const navigate = useNavigate();
  const location = useLocation();

  const cycle = (location.state as any)?.cycle as BillingCycle | undefined;
  const subscriptionType = ((location.state as any)?.subscriptionType as string | undefined) || "paid";

  const amount = useMemo(() => {
    const isEdu = (subscriptionType || "paid").toLowerCase() === "education";
    if (isEdu) return cycle === "yearly" ? 4800 : 400;
    return cycle === "yearly" ? 264 : 22;
  }, [cycle, subscriptionType]);

  // Saved card state
  const [useSavedCard, setUseSavedCard] = useState(false);
  const [savedCard, setSavedCard] = useState<null | { card_brand: string; last4: string; exp_month: number; exp_year: number }>(null);

  // UI hints and status
  const [showSuccess, setShowSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const goBack = () => navigate("/upgrade");
  const close = () => navigate("/reguserhome");

  // Elements handle card validation; no manual card number state required.

  // Prefill from saved card (if any) using metadata schema
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = (await supabase.auth.getUser()).data.user;
        if (!user) return;
        const { data, error } = await supabase
          .from("user_payment_cards")
          .select("card_brand,last4,exp_month,exp_year")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error || !data) return;
        if (!mounted) return;
        setSavedCard({
          card_brand: (data.card_brand || "unknown").toString(),
          last4: (data.last4 || "").toString(),
          exp_month: Number(data.exp_month) || 0,
          exp_year: Number(data.exp_year) || 0,
        });
        setUseSavedCard(true);
      } catch {
        // ignore prefill errors
      }
    })();
    return () => { mounted = false; };
  }, []);

  const formValid = useMemo(() => {
    if (useSavedCard && savedCard) return true;
    return false; // manual card path has its own button inside form
  }, [useSavedCard, savedCard]);

  const onPay = async () => {
    if (!formValid) return;
    setDbError(null); setSaving(true);
    try {
      const sess = (await supabase.auth.getSession()).data.session;
      const token = sess?.access_token as string | undefined;
      if (!token) throw new Error("Not authenticated");
      let body: any;
      if (useSavedCard && savedCard) {
        body = { plan_type: cycle ?? "monthly", subscription_type: subscriptionType, amount, use_saved_card: true };
      } else {
        // For manual card entry, the child CheckoutCardForm handles submission
        return; // prevent double-submit
      }

      const resp = await fetch(`${import.meta.env.VITE_API_URL}/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setShowSuccess(true);
    } catch (e: any) {
      setDbError(e?.message || "Payment failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const redirectToPaid = () => {
    try { window.location.assign("/paiduserhome"); } catch { navigate("/paiduserhome"); }
  };

  return (
    <>
      <AskVoxStarBackground />

      <div className={styles.page}>
        <button className={styles.logoBtn} onClick={close} aria-label="Back">
          <img src={AskVoxLogo} alt="AskVox" className={styles.logo} />
        </button>

        <button className={styles.closeBtn} onClick={close} aria-label="Close">
          <X size={18} />
        </button>

        <div className={styles.panel}>
          <div className={styles.leftCard}>
            <div className={styles.leftImage} style={{ backgroundImage: PAYMENT_IMAGE ? `url(${PAYMENT_IMAGE})` : undefined }} />
          </div>

          <div className={styles.rightCard}>
            <h1 className={styles.heading}>Payment Details {subscriptionType === "education" ? "• Educational" : ""} <span className={styles.sparkle}>✨</span></h1>

            {/* Saved card summary or manual card entry */}
            <label className={styles.label}>Card Number</label>

            {useSavedCard && savedCard ? (
              <>
                <div style={{ border: "1px solid #A25600", borderRadius: 16, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <CardBrandIcon brand={(savedCard.card_brand as Brand) || "unknown"} />
                    <div style={{ fontWeight: 600 }}>{savedCard.card_brand.toUpperCase()} •••• {savedCard.last4}</div>
                    <div style={{ marginLeft: "auto", opacity: 0.8 }}>Expires {`${String(savedCard.exp_month).padStart(2, "0")}/${String(savedCard.exp_year).slice(-2)}`}</div>
                  </div>
                </div>
                <button className={styles.altSwitchBtn} type="button" onClick={() => setUseSavedCard(false)}>
                  Use a different card
                </button>
              </>
            ) : (
              <Elements stripe={stripePromise}>
                <CheckoutCardForm amount={amount} cycle={cycle} subscriptionType={subscriptionType} onSuccess={() => setShowSuccess(true)} setError={setDbError} />
              </Elements>
            )}


            <div className={styles.savedNote}>Card details are auto-saved</div>

            <div className={styles.totalRow}>
              <div className={styles.totalLabel}>Total Amount:</div>
              <div className={styles.totalValue}>${amount}/{cycle === "yearly" ? "year" : "month"}</div>
            </div>

            {useSavedCard && savedCard ? (
              <button className={`${styles.payBtn} ${(!formValid || saving) ? styles.payBtnDisabled : ""}`} onClick={onPay} disabled={!formValid || saving}>
                {saving ? "Processing..." : `Pay $${amount}`}
              </button>
            ) : null}

            {dbError && <div className={styles.errorText}>{dbError}</div>}

            <button className={styles.backLink} onClick={goBack} type="button">← Back to plans</button>
          </div>
        </div>

        {showSuccess && (
          <div className={styles.modalOverlay} onClick={redirectToPaid} role="presentation">
            <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Payment success">
              <button className={styles.modalClose} type="button" aria-label="Close" onClick={redirectToPaid}><X size={18} /></button>
              <div className={styles.modalIconWrap}><CheckCircle2 className={styles.modalIcon} size={64} /></div>
              <h2 className={styles.modalTitle}>Payment Successful</h2>
              <p className={styles.modalText}>You’ve paid <b>${amount}</b> ({cycle === "yearly" ? "Yearly" : "Monthly"}) for {subscriptionType === "education" ? "Educational" : "Paid"} plan.</p>
              <div className={styles.modalActions}><button className={styles.modalBtnPrimary} onClick={redirectToPaid}>Continue</button></div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
