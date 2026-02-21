import { useState } from "react";
import { Elements, CardNumberElement, CardExpiryElement, CardCvcElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { stripePromise } from "../../stripe";
import { supabase } from "../../supabaseClient";
import styles from "./billing.module.css";

function InnerForm({ onSaved }: { onSaved?: (card: any) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [numOk, setNumOk] = useState(false);
  const [expOk, setExpOk] = useState(false);
  const [cvcOk, setCvcOk] = useState(false);

  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setErr(null);
    try {
      const cardEl = elements.getElement(CardNumberElement);
      if (!cardEl) throw new Error("Card details not ready");
      const pmRes = await stripe.createPaymentMethod({ type: "card", card: cardEl, billing_details: { name: name.trim() || undefined } });
      if (pmRes.error) throw new Error(pmRes.error.message || "Failed to create PaymentMethod");
      const pm = pmRes.paymentMethod;
      if (!pm?.id) throw new Error("Missing PaymentMethod id");

      // Call backend to attach PM to Stripe Customer and store metadata in Supabase
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token as string | undefined;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(`${import.meta.env.VITE_API_URL}/billing/stripe/attach-payment-method`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ payment_method_id: pm.id }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const out = await resp.json();
      if (onSaved) onSaved(out?.card);
    } catch (e: any) {
      setErr(e?.message || "Failed to save card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label className={styles.fieldLabel}>Card Number</label>
      <div style={{ background: "#1C1C1C", border: "1px solid #A25600", borderRadius: 32, padding: 12 }}>
        <CardNumberElement
          onChange={(e) => setNumOk(!!e.complete)}
          options={{ disableLink: true, style: { base: { color: "#fff", fontSize: "16px" } } }}
        />
      </div>

      <label className={styles.fieldLabel}>Card Holder Name</label>
      <input
        className={styles.input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Enter your Full name..."
        autoComplete="cc-name"
      />

      <div className={styles.inputRow}>
        <div className={styles.inputCol}>
          <label className={styles.fieldLabel}>Expiry Date: *</label>
          <div style={{ background: "#1C1C1C", border: "1px solid #A25600", borderRadius: 32, padding: 12 }}>
            <CardExpiryElement onChange={(e) => setExpOk(!!e.complete)} options={{ style: { base: { color: "#fff", fontSize: "16px" } } }} />
          </div>
        </div>
        <div className={styles.inputCol}>
          <label className={styles.fieldLabel}>CVV/CVV2: *</label>
          <div style={{ background: "#1C1C1C", border: "1px solid #A25600", borderRadius: 32, padding: 12 }}>
            <CardCvcElement onChange={(e) => setCvcOk(!!e.complete)} options={{ style: { base: { color: "#fff", fontSize: "16px" } } }} />
          </div>
        </div>
      </div>

      {err && <div className={styles.error}>{err}</div>}
      <div className={styles.modalActions}>
        <button
          className={styles.btnPrimary}
          disabled={busy || !stripe || !elements || !(numOk && expOk && cvcOk && (name.trim().length > 1))}
          onClick={submit}
        >
          {busy ? "Saving…" : "Save & Update Payment Method"}
        </button>
      </div>
    </>
  );
}

export default function StripeCardForm({ onSaved }: { onSaved?: (card: any) => void }) {
  return (
    <Elements stripe={stripePromise}>
      <InnerForm onSaved={onSaved} />
    </Elements>
  );
}
