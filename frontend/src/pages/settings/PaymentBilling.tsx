import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../supabaseClient";
import styles from "./billing.module.css";
import { DollarSign, Pencil, X, CreditCard as CardIcon } from "lucide-react";
import StripeCardForm from "./StripeCardForm";

type CardRow = {
  user_id: string;
  stripe_customer_id?: string | null;
  stripe_payment_method_id?: string | null;
  card_brand: string; // e.g., visa/mastercard/amex
  last4: string;
  exp_month: number;
  exp_year: number;
};

type SubscriptionRow = {
  plan_type?: string | null;
  billing_period?: string | null;
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
  const navigate = useNavigate();
  const userId = session.user.id;
  const [card, setCard] = useState<CardRow | null>(null);
  const [sub, setSub] = useState<SubscriptionRow | null>(null);
  const [history, setHistory] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyCancel, setBusyCancel] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeMsg, setRemoveMsg] = useState<string | null>(null);

  // Edit modal state
  const [showEdit, setShowEdit] = useState(false);
  // Legacy manual card fields removed; Stripe Elements handles input securely.

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [cardRes, subRes, histRes] = await Promise.all([
          supabase
            .from("user_payment_cards")
            .select("user_id,stripe_customer_id,stripe_payment_method_id,card_brand,last4,exp_month,exp_year")
            .eq("user_id", userId)
            .maybeSingle(),
          supabase
            .from("subscriptions")
            .select("plan_type,billing_period,start_date,end_date,is_active")
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

  const last4 = useMemo(() => card?.last4 || "", [card]);

  const planLabel = useMemo(() => {
    if (!sub?.is_active) return "No active subscription";
    const plan = (sub.plan_type || "paid").toLowerCase();
    const period = (sub.billing_period || "monthly").toLowerCase();
    const suffix = period === "yearly" ? " (Yearly)" : "";
    if (plan === "education") return `AskVox Educational Plan${suffix}`;
    return `AskVox Premium Plan${suffix}`;
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

  const handleCancel = () => {
    if (!sub?.is_active) return;
    setShowCancel(true);
    setCancelMsg(null);
  };

  const confirmCancel = async () => {
    if (!sub?.is_active) { setShowCancel(false); return; }
    setBusyCancel(true);
    setErr(null);
    setCancelMsg(null);
    try {
      const sess = (await supabase.auth.getSession()).data.session;
      const token = sess?.access_token as string | undefined;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch("http://localhost:8000/billing/subscription", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(await resp.text());

      // Locally clear subscription state
      setSub((s) => (s ? { ...s, is_active: false } : s));
      setShowCancel(false);
      // Redirect to normal registered page
      try {
        window.location.assign("/reguserhome");
      } catch {
        navigate("/reguserhome");
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to cancel subscription");
    } finally {
      setBusyCancel(false);
    }
  };

  // Stripe handles validation; manual helpers removed.

  // Open edit modal
  const openEdit = () => {
    setErr(null);
    setRemoveMsg(null);
    setShowEdit(true);
  };

  const closeEdit = () => {
    setShowEdit(false);
    setRemoveMsg(null);
    setErr(null);
  };

  // Legacy manual save flow removed; StripeCardForm handles submission.

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
              {sub?.is_active && card && (
                <div className={styles.planCardMeta}>
                  <span className={styles.cardBadgeIcon}><BrandIcon brand={(card.card_brand as any) || "visa"} /></span>
                  <span className={styles.cardMask}>{brandText(card.card_brand)} •••• {last4}</span>
                </div>
              )}
            </div>
            <div className={styles.planRight}>
              {sub?.is_active ? (
                <button className={styles.btnSecondary} onClick={handleCancel} disabled={busyCancel}>
                  Cancel Subscription
                </button>
              ) : (
                <a className={styles.btnSecondary} href="/upgrade">Upgrade</a>
              )}
            </div>
          </section>

          {/* Payment Method */}
          <section className={styles.methodCard}>
            <div className={styles.sectionTitle}>Payment Method:</div>
            <div className={styles.methodRow}>
              <div className={styles.methodLeft}>
                {card && (
                  <span className={styles.cardBadgeIcon}><BrandIcon brand={card.card_brand as any} /></span>
                )}
                {card ? (
                  <>
                    <div className={styles.methodText}>
                      {brandText(card.card_brand)} •••• {last4}
                    </div>
                    <div className={styles.methodSub}>Expires {card ? `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}` : "--/--"}</div>
                  </>
                ) : (
                  <div className={styles.methodText}>Nil — add a card</div>
                )}
              </div>
              <div className={styles.methodRight}>
                  {card ? (
                  <button className={styles.editBtn} onClick={openEdit} title="Update card" aria-label="Edit card">
                    <Pencil size={18} />
                  </button>
                ) : (
                  <button className={styles.btnPrimary} onClick={openEdit} title="Add Card">Add Card</button>
                )}
              </div>
            </div>
            {saveSuccess && (
              <div className={styles.successInline}>
                <span className={styles.successDot} />
                <span className={styles.successText}>Payment Method updated successfully</span>
              </div>
            )}
          </section>

          {/* Payment History */}
          <section className={styles.methodCard}>
            <div className={styles.sectionTitle}>Payment History:</div>
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
          {cancelMsg && (
            <div className={styles.successInline} style={{ marginTop: 10 }}>
              <span className={styles.successDot} />
              <span className={styles.successText}>{cancelMsg}</span>
            </div>
          )}

          {/* Edit Card Modal */}
          {showEdit && (
            <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="Edit payment method" onClick={closeEdit}>
              <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <button className={styles.modalClose} onClick={closeEdit} aria-label="Close">
                  <X size={18} />
                </button>

                <div className={styles.modalHeaderRow}>
                  <div className={styles.headerIcon}><CardIcon size={18} /></div>
                  <div className={styles.modalTitle}>Payment Method</div>
                </div>

                <div className={styles.modalSection}>
                  <div className={styles.sectionLabel}>Current Payment Method :</div>
                  {card ? (
                    <div className={styles.currentCardBox}>
                      <span className={styles.cardBadgeIcon}><BrandIcon brand={card.card_brand as any} /></span>
                      <span className={styles.cardMask}>{brandText(card.card_brand)} •••• {last4}</span>
                      <span className={styles.methodSub}>Expires {card ? `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}` : "--/--"}</span>
                      <span className={styles.rightPush} />
                      <button
                        className={styles.btnDanger}
                        disabled={removeBusy}
                        onClick={async () => {
                          setRemoveBusy(true); setErr(null); setRemoveMsg(null);
                          try {
                            const sess = (await supabase.auth.getSession()).data.session;
                            const token = sess?.access_token as string | undefined;
                            if (!token) throw new Error("Not authenticated");
                            const resp = await fetch("http://localhost:8000/billing/card", {
                              method: "DELETE",
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            if (!resp.ok) throw new Error(await resp.text());
                            // update UI: clear card
                            setCard(null);
                            setRemoveMsg("Card removed. You can add a new one below.");
                          } catch (e: any) {
                            setErr(e?.message || "Failed to remove card");
                          } finally {
                            setRemoveBusy(false);
                          }
                        }}
                      >
                        {removeBusy ? "Removing…" : "Remove Card"}
                      </button>
                    </div>
                  ) : (
                    <div className={styles.currentCardBox}>
                      <span className={styles.cardMask}>Nil — no card on file</span>
                    </div>
                  )}
                  {!card && removeMsg && (
                    <div className={styles.successInline} style={{ marginTop: 10 }}>
                      <span className={styles.successDot} />
                      <span className={styles.successText}>{removeMsg}</span>
                    </div>
                  )}
                </div>

                <div className={styles.modalSection}>
                  <div className={styles.sectionLabel}>Update Payment Method :</div>

                  {/* Stripe secure card form (recommended) */}
                  <StripeCardForm
                    onSaved={(updated) => {
                      if (updated) setCard(updated);
                      closeEdit();
                      setSaveSuccess(true);
                      window.setTimeout(() => setSaveSuccess(false), 4000);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Cancel Subscription Modal */}
          {showCancel && (
            <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="Cancel subscription" onClick={() => !busyCancel && setShowCancel(false)}>
              <div className={`${styles.modalNarrow}`} onClick={(e) => e.stopPropagation()}>
                <button className={styles.modalClose} onClick={() => !busyCancel && setShowCancel(false)} aria-label="Close">
                  <X size={18} />
                </button>
                <div className={styles.modalHeaderRow}>
                  <div className={styles.headerIcon}><DollarSign size={18} /></div>
                  <div className={styles.modalTitle}>Cancel Subscription</div>
                </div>
                <div className={styles.modalSection}>
                  <div className={styles.sectionLabel}>Are you sure?</div>
                  <p style={{ opacity: 0.9, lineHeight: 1.6 }}>This will cancel your {sub?.plan_type === 'education' ? 'Educational' : 'Paid'} subscription. You may lose premium access immediately.</p>
                  {err && <div className={styles.error} style={{ marginTop: 8 }}>{err}</div>}
                  <div className={styles.modalActions}>
                    <button className={styles.btnPrimary} onClick={confirmCancel} disabled={busyCancel}>
                      {busyCancel ? "Cancelling…" : "Cancel Subscription"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
