import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";
import styles from "./billing.module.css";
import { DollarSign, Pencil, X, CreditCard as CardIcon } from "lucide-react";

type CardRow = {
  user_id: string;
  card_number: string; // stored as digits in current schema
  card_holder_name: string;
  expiry_date: string; // MM/YY
  card_type?: string | null; // visa/mastercard/amex
};

type SubscriptionRow = {
  plan_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean | null;
};

type PaymentRow = {
  id: string;
  amount: number;
  description?: string | null;
  transaction_status?: string | null;
  created_at?: string | null;
};

export default function PaymentBilling({ session }: { session: Session }) {
  const userId = session.user.id;
  const [card, setCard] = useState<CardRow | null>(null);
  const [sub, setSub] = useState<SubscriptionRow | null>(null);
  const [history, setHistory] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyCancel, setBusyCancel] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Edit modal state
  const [showEdit, setShowEdit] = useState(false);
  const [cNumber, setCNumber] = useState("");
  const [cName, setCName] = useState("");
  const [cExp, setCExp] = useState("");
  const [cCvv, setCCvv] = useState("");
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [cardRes, subRes, histRes] = await Promise.all([
          supabase.from("user_payment_cards").select("*").eq("user_id", userId).single(),
          supabase
            .from("subscriptions")
            .select("plan_type,start_date,end_date,is_active")
            .eq("user_id", userId)
            .order("end_date", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("payment_history")
            .select("id,amount,description,transaction_status,created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(12),
        ]);

        if (!mounted) return;
        setCard(cardRes.data ?? null);
        setSub(subRes.data ?? null);
        setHistory(histRes.data ?? []);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message || "Failed to load billing info");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  // Brand icons to match Payment page visuals
  function BrandIcon({ brand }: { brand: "visa" | "mastercard" | "amex" | "unknown" | null | undefined }) {
    const b = (brand || "unknown") as any;
    if (b === "mastercard") {
      return (
        <svg width="36" height="24" viewBox="0 0 36 24" aria-label="Mastercard" role="img">
          <circle cx="14" cy="12" r="8" fill="#EB001B" />
          <circle cx="22" cy="12" r="8" fill="#F79E1B" fillOpacity="0.95" />
        </svg>
      );
    }
    if (b === "visa") {
      return (
        <svg width="36" height="24" viewBox="0 0 36 24" aria-label="Visa" role="img">
          <rect x="0" y="0" width="36" height="24" rx="7" fill="#1A1F71" />
          <text x="18" y="16" textAnchor="middle" fontSize="10" fill="#fff" fontFamily="system-ui" fontWeight="700" letterSpacing="1">VISA</text>
        </svg>
      );
    }
    if (b === "amex") {
      return (
        <svg width="36" height="24" viewBox="0 0 36 24" aria-label="American Express" role="img">
          <rect x="0" y="0" width="36" height="24" rx="7" fill="#2E77BB" />
          <text x="18" y="16" textAnchor="middle" fontSize="9" fill="#fff" fontFamily="system-ui" fontWeight="700" letterSpacing="0.6">AMEX</text>
        </svg>
      );
    }
    return null;
  }

  const last4 = useMemo(() => {
    const digits = card?.card_number || "";
    return digits ? digits.slice(-4) : "";
  }, [card]);

  const planLabel = useMemo(() => {
    if (!sub?.is_active) return "No active subscription";
    const t = sub.plan_type || "monthly";
    return t === "yearly" ? "AskVox Premium Plan (Yearly)" : "AskVox Premium Plan";
  }, [sub]);

  const brandText = (ct?: string | null) => {
    const b = (ct || "").toLowerCase();
    if (b === "visa") return "Visa";
    if (b === "mastercard") return "Mastercard";
    if (b === "amex") return "Amex";
    return "Card";
  };

  const renewText = useMemo(() => {
    if (!sub?.is_active || !sub?.end_date) return "";
    try {
      const d = new Date(sub.end_date);
      const pretty = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      return `Plan auto-renew on ${pretty}`;
    } catch {
      return "";
    }
  }, [sub]);

  const handleCancel = async () => {
    if (!sub?.is_active) return;
    if (!confirm("Cancel your subscription? You'll keep access until the current period ends.")) return;
    setBusyCancel(true);
    setErr(null);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("subscriptions")
        .update({ is_active: false, end_date: nowIso })
        .eq("user_id", userId);
      if (error) throw error;
      setSub((s) => (s ? { ...s, is_active: false, end_date: nowIso } : s));
    } catch (e: any) {
      setErr(e?.message || "Failed to cancel subscription");
    } finally {
      setBusyCancel(false);
    }
  };

  // -------- helpers copied from payment.tsx (trimmed) --------
  type Brand = "visa" | "mastercard" | "amex" | "unknown";
  const onlyDigits = (s: string) => s.replace(/\D/g, "");
  function detectBrand(digits: string): Brand {
    if (/^4/.test(digits)) return "visa";
    if (/^(5[1-5])/.test(digits) || /^(222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)/.test(digits)) return "mastercard";
    if (/^(34|37)/.test(digits)) return "amex";
    return "unknown";
  }
  function luhnCheck(digits: string): boolean {
    let sum = 0; let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48; if (d < 0 || d > 9) return false;
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return sum % 10 === 0;
  }
  function formatCardNumber(digits: string, brand: Brand): string {
    if (brand === "amex") {
      const a = digits.slice(0, 4), b = digits.slice(4, 10), c = digits.slice(10, 15);
      return [a, b, c].filter(Boolean).join(" ");
    }
    return digits.replace(/(.{4})/g, "$1 ").trim();
  }
  function formatExpiry(input: string): string {
    const d = onlyDigits(input).slice(0, 4);
    if (d.length <= 2) return d;
    return `${d.slice(0,2)}/${d.slice(2)}`;
  }
  function parseExpiry(exp: string): { mm: number; yy: number } | null {
    const m = exp.match(/^(\d{2})\/(\d{2})$/); if (!m) return null;
    const mm = Number(m[1]); const yy = Number(m[2]);
    if (!Number.isFinite(mm) || !Number.isFinite(yy)) return null; return { mm, yy };
  }
  function isExpired(exp: { mm: number; yy: number }): boolean {
    const { mm, yy } = exp; if (mm < 1 || mm > 12) return true;
    const fullYear = 2000 + yy; const now = new Date();
    const cy = now.getFullYear(); const cm = now.getMonth() + 1;
    if (fullYear < cy) return true; if (fullYear === cy && mm < cm) return true; return false;
  }
  // -----------------------------------------------------------

  // Pre-fill modal when opening
  const openEdit = () => {
    const digits = card?.card_number || "";
    const brand = detectBrand(digits);
    const maxLen = brand === "amex" ? 15 : 16;
    const limited = digits.slice(0, maxLen);
    setCNumber(formatCardNumber(limited, brand));
    setCName(card?.card_holder_name || "");
    setCExp(card?.expiry_date || "");
    setCCvv(""); // do not prefill cvv
    setFormErr(null);
    setShowEdit(true);
  };

  const brand = useMemo(() => detectBrand(onlyDigits(cNumber)), [cNumber]);
  const neededCvv = brand === "amex" ? 4 : 3;
  const cardDigits = useMemo(() => onlyDigits(cNumber).slice(0, brand === "amex" ? 15 : 16), [cNumber, brand]);
  const cardDisplay = useMemo(() => formatCardNumber(cardDigits, brand), [cardDigits, brand]);

  const formValid = useMemo(() => {
    if (brand === "unknown") return false;
    const lenOk = (brand === "amex" && cardDigits.length === 15) || (brand !== "amex" && cardDigits.length === 16);
    if (!lenOk) return false;
    if (!luhnCheck(cardDigits)) return false;
    if ((cName || "").trim().length < 2) return false;
    const p = parseExpiry(cExp); if (!p) return false; if (p.mm < 1 || p.mm > 12) return false; if (isExpired(p)) return false;
    if (onlyDigits(cCvv).length !== neededCvv) return false;
    return true;
  }, [brand, cardDigits, cName, cExp, cCvv, neededCvv]);

  const disabledReason = useMemo(() => {
    if (brand === "unknown") return "Card type not supported (Visa / MasterCard / Amex)";
    const lenOk = (brand === "amex" && cardDigits.length === 15) || (brand !== "amex" && cardDigits.length === 16);
    if (!lenOk) return brand === "amex" ? "Amex card number must be 15 digits" : "Card number must be 16 digits";
    if (!luhnCheck(cardDigits)) return "Card number is invalid";
    if ((cName || "").trim().length < 2) return "Card holder name is required";
    const p = parseExpiry(cExp); if (!p) return "Use MM/YY format";
    if (p.mm < 1 || p.mm > 12) return "Month must be 01–12";
    if (isExpired(p)) return "Card is expired";
    if (onlyDigits(cCvv).length !== neededCvv) return `CVV must be ${neededCvv} digits`;
    return "";
  }, [brand, cardDigits, cName, cExp, cCvv, neededCvv]);

  const saveCard = async () => {
    setFormErr(null);
    if (!formValid) { setFormErr("Please complete all fields correctly."); return; }
    setSaving(true);
    try {
      const sess = (await supabase.auth.getSession()).data.session;
      const token = sess?.access_token as string | undefined;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch("http://localhost:8000/billing/card", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          card_number: cardDigits,
          card_holder_name: cName.trim(),
          expiry_date: cExp.trim(),
          card_type: brand,
          cvv: onlyDigits(cCvv),
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const out = await resp.json();
      const updated = (out?.card || null) as any;
      if (updated) setCard(updated as CardRow);
      setShowEdit(false);
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 4000);
    } catch (e: any) {
      setFormErr(e?.message || "Failed to update card");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <div className={styles.headerIcon}><DollarSign size={18} /></div>
        <h2 className={styles.header}>Payment &amp; Billing</h2>
      </div>

      {loading ? (
        <div className={styles.skeleton}>Loading billing…</div>
      ) : (
        <>
          {/* Plan block */}
          <section className={styles.planCard}>
            <div className={styles.planLeft}>
              <div className={styles.planTitle}>{planLabel}</div>
              {renewText && <div className={styles.planRenew}>{renewText}</div>}
              {card && (
                <div className={styles.planCardMeta}>
                  <span className={styles.cardBadgeIcon}><BrandIcon brand={(card.card_type as any) || "visa"} /></span>
                  <span className={styles.cardMask}>{brandText(card.card_type)} •••• {last4}</span>
                </div>
              )}
            </div>
            <div className={styles.planRight}>
              {sub?.is_active ? (
                <button className={styles.btnSecondary} onClick={handleCancel} disabled={busyCancel}>
                  {busyCancel ? "Processing…" : "Cancel Subscription"}
                </button>
              ) : (
                <a className={styles.btnSecondary} href="/payment">Upgrade</a>
              )}
            </div>
          </section>

          {/* Payment Method */}
          <section className={styles.methodCard}>
            <div className={styles.sectionTitle}>Payment Method:</div>
            <div className={styles.methodRow}>
              <div className={styles.methodLeft}>
                <span className={styles.cardBadgeIcon}><BrandIcon brand={(card?.card_type as any) || "visa"} /></span>
                {card ? (
                  <>
                    <div className={styles.methodText}>
                      {brandText(card.card_type)} •••• {last4}
                    </div>
                    <div className={styles.methodSub}>Expires {card.expiry_date || "--/--"}</div>
                  </>
                ) : (
                  <div className={styles.methodText}>Nil — add a card</div>
                )}
              </div>
              <div className={styles.methodRight}>
                <button className={styles.editBtn} onClick={openEdit} title="Update card">
                  <Pencil size={18} />
                </button>
              </div>
            </div>
            {saveSuccess && (
              <div className={styles.successInline}>
                <span className={styles.successDot} />
                <span className={styles.successText}>Payment Method updated successfully</span>
              </div>
            )}

            <div className={styles.sectionTitle} style={{ marginTop: 24 }}>Payment History:</div>
            {history.length === 0 ? (
              <div className={styles.empty}>No payments yet.</div>
            ) : (
              <ul className={styles.historyList}>
                {history.map((h) => (
                  <li key={h.id} className={styles.historyItem}>
                    <span className={styles.hDate}>
                      {h.created_at ? new Date(h.created_at).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" }) : "--"}
                    </span>
                    <span className={styles.hAmount}>${h.amount?.toFixed(2)}</span>
                    <span className={styles.hStatus}>Paid</span>
                    <span className={styles.hDesc}>{h.description || "AskVox Premium Subscription"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {err && <div className={styles.error}>{err}</div>}

          {/* Edit Card Modal */}
          {showEdit && (
            <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="Edit payment method" onClick={() => setShowEdit(false)}>
              <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <button className={styles.modalClose} onClick={() => setShowEdit(false)} aria-label="Close">
                  <X size={18} />
                </button>

                <div className={styles.modalHeaderRow}>
                  <div className={styles.headerIcon}><CardIcon size={18} /></div>
                  <div className={styles.modalTitle}>Payment Method</div>
                </div>

                <div className={styles.modalSection}>
                  <div className={styles.sectionLabel}>Current Payment Method :</div>
                  <div className={styles.currentCardBox}>
                    <span className={styles.cardBadgeIcon}><BrandIcon brand={(card?.card_type as any) || "visa"} /></span>
                    <span className={styles.cardMask}>{brandText(card?.card_type)} •••• {last4}</span>
                    <span className={styles.methodSub}>Expires {card?.expiry_date || "--/--"}</span>
                  </div>
                </div>

                <div className={styles.modalSection}>
                  <div className={styles.sectionLabel}>Update Payment Method: :</div>

                  <label className={styles.fieldLabel}>Card Number</label>
                  <input
                    className={styles.input}
                    value={cardDisplay}
                    onChange={(e) => {
                      const d = onlyDigits(e.target.value);
                      const b = detectBrand(d);
                      const ml = b === "amex" ? 15 : 16;
                      setCNumber(formatCardNumber(d.slice(0, ml), b));
                    }}
                    placeholder="5264 **** **** 1267"
                    inputMode="numeric"
                    autoComplete="cc-number"
                  />

                  <label className={styles.fieldLabel}>Card Holder Name</label>
                  <input
                    className={styles.input}
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    placeholder="Enter your Full name..."
                    autoComplete="cc-name"
                  />

                  <div className={styles.inputRow}>
                    <div className={styles.inputCol}>
                      <label className={styles.fieldLabel}>Expiry Date: *</label>
                      <input
                        className={styles.input}
                        value={cExp}
                        onChange={(e) => setCExp(formatExpiry(e.target.value))}
                        placeholder="mm / yy"
                        inputMode="numeric"
                        autoComplete="cc-exp"
                      />
                    </div>
                    <div className={styles.inputCol}>
                      <label className={styles.fieldLabel}>CVV/CVV2: *</label>
                      <input
                        className={styles.input}
                        type="password"
                        value={cCvv}
                        onChange={(e) => setCCvv(onlyDigits(e.target.value).slice(0, neededCvv))}
                        placeholder={neededCvv === 4 ? "xxxx" : "xxx"}
                        inputMode="numeric"
                        autoComplete="cc-csc"
                      />
                    </div>
                  </div>

                  {formErr && <div className={styles.error}>{formErr}</div>}

                  <div className={styles.modalActions}>
                    <button className={styles.btnPrimary} disabled={!formValid || saving} onClick={saveCard}>
                      {saving ? "Saving…" : "Save & Update Payment Method"}
                    </button>
                  </div>
                  {!formValid && !saving && (
                    <div className={styles.error} style={{ marginTop: 10 }}>{disabledReason || "Please complete all fields correctly."}</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
