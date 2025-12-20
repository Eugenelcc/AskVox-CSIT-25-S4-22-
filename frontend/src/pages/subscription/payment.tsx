import { useMemo, useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X, CheckCircle2 } from "lucide-react";
import { supabase } from "../../supabaseClient";

import AskVoxLogo from "../../components/TopBars/AskVox.png";
import AskVoxStarBackground from "../../components/background/background";
import styles from "./payment.module.css";
import PaymentImage from "./card_stack.png";

const PAYMENT_IMAGE = PaymentImage;

type BillingCycle = "monthly" | "yearly";
type Brand = "visa" | "mastercard" | "amex" | "unknown";

/* -------------------- helpers -------------------- */
const onlyDigits = (s: string) => s.replace(/\D/g, "");

function detectBrand(digits: string): Brand {
  if (/^4/.test(digits)) return "visa";

  // MasterCard: 51-55 or 2221-2720
  if (
    /^(5[1-5])/.test(digits) ||
    /^(222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)/.test(digits)
  ) {
    return "mastercard";
  }

  // Amex: 34 or 37
  if (/^(34|37)/.test(digits)) return "amex";

  return "unknown";
}

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;

    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function formatCardNumber(digits: string, brand: Brand): string {
  if (brand === "amex") {
    // 4-6-5
    const a = digits.slice(0, 4);
    const b = digits.slice(4, 10);
    const c = digits.slice(10, 15);
    return [a, b, c].filter(Boolean).join(" ");
  }
  // groups of 4
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(input: string): string {
  const d = onlyDigits(input).slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

function parseExpiry(exp: string): { mm: number; yy: number } | null {
  const m = exp.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const yy = Number(m[2]);
  if (!Number.isFinite(mm) || !Number.isFinite(yy)) return null;
  return { mm, yy };
}

function isExpired(exp: { mm: number; yy: number }): boolean {
  const { mm, yy } = exp;
  if (mm < 1 || mm > 12) return true;

  const fullYear = 2000 + yy;
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  if (fullYear < curYear) return true;
  if (fullYear === curYear && mm < curMonth) return true;
  return false;
}

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

/* -------------------- component -------------------- */
export default function Payment() {
  const navigate = useNavigate();
  const location = useLocation();

  const cycle = (location.state as any)?.cycle as BillingCycle | undefined;

  const amount = useMemo(() => {
    if (cycle === "yearly") return 264;
    return 22;
  }, [cycle]);

  const [cardNumber, setCardNumber] = useState("");
  const [holderName, setHolderName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");

  const [tCard, setTCard] = useState(false);
  const [tName, setTName] = useState(false);
  const [tExp, setTExp] = useState(false);
  const [tCvv, setTCvv] = useState(false);

  // ✅ success popup
  const [showSuccess, setShowSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const goBack = () => navigate("/upgrade");
  const close = () => navigate("/reguserhome");

  const cardDigits = useMemo(() => onlyDigits(cardNumber), [cardNumber]);
  const brand = useMemo(() => detectBrand(cardDigits), [cardDigits]);

  const maxCardLen = brand === "amex" ? 15 : 16;

  const cardDigitsLimited = useMemo(() => cardDigits.slice(0, maxCardLen), [cardDigits, maxCardLen]);

  const cardDisplay = useMemo(
    () => formatCardNumber(cardDigitsLimited, brand),
    [cardDigitsLimited, brand]
  );

  // Prefill from saved card (if any)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = (await supabase.auth.getUser()).data.user;
        if (!user) return;
        const { data, error } = await supabase
          .from("user_payment_cards")
          .select("card_number, card_holder_name, expiry_date")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error || !data) return;

        const digits = onlyDigits(data.card_number || "");
        const b = detectBrand(digits);
        const ml = b === "amex" ? 15 : 16;
        const limited = digits.slice(0, ml);
        if (!mounted) return;
        setCardNumber(formatCardNumber(limited, b));
        setHolderName((data.card_holder_name || "").toString());
        setExpiry((data.expiry_date || "").toString());
        // Intentionally do not set CVV
      } catch {
        // ignore prefill errors
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const cardError = useMemo(() => {
    if (!tCard) return "";
    if (cardDigitsLimited.length === 0) return "Card number is required";
    if (brand === "unknown") return "Card type not supported (Visa / MasterCard / Amex)";
    if (brand === "amex") {
      if (cardDigitsLimited.length !== 15) return "Amex card number must be 15 digits";
    } else {
      if (cardDigitsLimited.length !== 16) return "Card number must be 16 digits";
    }
    if (!luhnCheck(cardDigitsLimited)) return "Card number is invalid";
    return "";
  }, [tCard, cardDigitsLimited, brand]);

  const nameError = useMemo(() => {
    if (!tName) return "";
    if (holderName.trim().length === 0) return "Card holder name is required";
    if (holderName.trim().length < 2) return "Name is too short";
    return "";
  }, [tName, holderName]);

  const expParsed = useMemo(() => parseExpiry(expiry), [expiry]);

  const expiryError = useMemo(() => {
    if (!tExp) return "";
    if (expiry.trim().length === 0) return "Expiry is required";
    const p = expParsed;
    if (!p) return "Use MM/YY format";
    if (p.mm < 1 || p.mm > 12) return "Month must be 01–12";
    if (isExpired(p)) return "Card is expired";
    return "";
  }, [tExp, expiry, expParsed]);

  const cvvDigits = useMemo(() => onlyDigits(cvv), [cvv]);

  const cvvError = useMemo(() => {
    if (!tCvv) return "";
    if (cvvDigits.length === 0) return "CVV is required";
    const needed = brand === "amex" ? 4 : 3;
    if (cvvDigits.length !== needed) return `CVV must be ${needed} digits`;
    return "";
  }, [tCvv, cvvDigits, brand]);

  const formValid = useMemo(() => {
    if (brand === "unknown") return false;

    const correctLen =
      (brand === "amex" && cardDigitsLimited.length === 15) ||
      (brand !== "amex" && cardDigitsLimited.length === 16);

    if (!correctLen) return false;
    if (!luhnCheck(cardDigitsLimited)) return false;
    if (holderName.trim().length < 2) return false;

    const p = expParsed;
    if (!p) return false;
    if (p.mm < 1 || p.mm > 12) return false;
    if (isExpired(p)) return false;

    const needed = brand === "amex" ? 4 : 3;
    if (cvvDigits.length !== needed) return false;

    return true;
  }, [brand, cardDigitsLimited, holderName, expParsed, cvvDigits]);

  const onPay = async () => {
    setTCard(true);
    setTName(true);
    setTExp(true);
    setTCvv(true);

    if (!formValid) return;
    setDbError(null);
    setSaving(true);

    try {
      const sess = (await supabase.auth.getSession()).data.session;
      const token = sess?.access_token as string | undefined;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch("http://localhost:8000/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          card_number: cardDigitsLimited,
          card_holder_name: holderName.trim(),
          expiry_date: expiry.trim(),
          card_type: brand,
          plan_type: cycle ?? "monthly",
          amount,
          cvv: cvvDigits,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setShowSuccess(true);
    } catch (e: any) {
      setDbError(e?.message || "Payment failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Redirect to paid home with a full refresh
  const redirectToPaid = () => {
    try {
      window.location.assign("/paiduserhome");
    } catch {
      navigate("/paiduserhome");
    }
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
            <div
              className={styles.leftImage}
              style={{
                backgroundImage: PAYMENT_IMAGE ? `url(${PAYMENT_IMAGE})` : undefined,
              }}
            />
          </div>

          <div className={styles.rightCard}>
            <h1 className={styles.heading}>
              Payment Details <span className={styles.sparkle}>✨</span>
            </h1>

            <label className={styles.label}>Card Number</label>

            <div className={styles.cardInputWrap}>
              <input
                className={`${styles.input} ${cardError ? styles.inputError : ""}`}
                value={cardDisplay}
                onChange={(e) => {
                  const d = onlyDigits(e.target.value).slice(0, maxCardLen);
                  const b = detectBrand(d);
                  const ml = b === "amex" ? 15 : 16;
                  const limited = d.slice(0, ml);
                  setCardNumber(formatCardNumber(limited, b));
                }}
                onBlur={() => setTCard(true)}
                placeholder="1234 5678 9012 3456"
                inputMode="numeric"
                autoComplete="cc-number"
              />

              {brand !== "unknown" && (
                <div className={styles.brandIcon}>
                  <CardBrandIcon brand={brand} />
                </div>
              )}
            </div>

            {cardError ? <div className={styles.errorText}>{cardError}</div> : null}

            <label className={styles.label}>Card Holder Name</label>
            <input
              className={`${styles.input} ${nameError ? styles.inputError : ""}`}
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              onBlur={() => setTName(true)}
              placeholder="Enter your Full name..."
              autoComplete="cc-name"
            />
            {nameError ? <div className={styles.errorText}>{nameError}</div> : null}

            <div className={styles.row}>
              <div className={styles.col}>
                <label className={styles.label}>Expiry Date: *</label>
                <input
                  className={`${styles.inputSmall} ${expiryError ? styles.inputError : ""}`}
                  value={expiry}
                  onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                  onBlur={() => setTExp(true)}
                  placeholder="MM/YY"
                  inputMode="numeric"
                  autoComplete="cc-exp"
                />
                {expiryError ? <div className={styles.errorText}>{expiryError}</div> : null}
              </div>

              <div className={styles.col}>
                <label className={styles.label}>CVV/CVV2: *</label>
                <input
                  className={`${styles.inputSmall} ${cvvError ? styles.inputError : ""}`}
                  value={cvvDigits}
                  onChange={(e) => {
                    const needed = brand === "amex" ? 4 : 3;
                    setCvv(onlyDigits(e.target.value).slice(0, needed));
                  }}
                  onBlur={() => setTCvv(true)}
                  placeholder={brand === "amex" ? "XXXX" : "XXX"}
                  inputMode="numeric"
                  autoComplete="cc-csc"
                />
                {cvvError ? <div className={styles.errorText}>{cvvError}</div> : null}
              </div>
            </div>

            <div className={styles.savedNote}>Card details are auto-saved</div>

            <div className={styles.totalRow}>
              <div className={styles.totalLabel}>Total Amount:</div>
              <div className={styles.totalValue}>
                ${amount}/{cycle === "yearly" ? "year" : "month"}
              </div>
            </div>

            <button
              className={`${styles.payBtn} ${(!formValid || saving) ? styles.payBtnDisabled : ""}`}
              onClick={onPay}
              disabled={!formValid || saving}
            >
              {saving ? "Processing..." : `Pay $${amount}`}
            </button>

            {dbError && <div className={styles.errorText}>{dbError}</div>}

            <button className={styles.backLink} onClick={goBack} type="button">
              ← Back to plans
            </button>
          </div>
        </div>

        {/* ✅ SUCCESS POPUP MODAL */}
        {showSuccess && (
          <div
            className={styles.modalOverlay}
            onClick={redirectToPaid}
            role="presentation"
          >
            <div
              className={styles.modal}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Payment success"
            >
              <button className={styles.modalClose} type="button" aria-label="Close" onClick={redirectToPaid}>
                <X size={18} />
              </button>

              <div className={styles.modalIconWrap}>
                <CheckCircle2 className={styles.modalIcon} size={64} />
              </div>

              <h2 className={styles.modalTitle}>Payment Successful</h2>
              <p className={styles.modalText}>
                You’ve paid <b>${amount}</b> ({cycle === "yearly" ? "Yearly" : "Monthly"}).
              </p>

              <div className={styles.modalActions}>
                <button
                  className={styles.modalBtnPrimary}
                  onClick={redirectToPaid}
                >
                  Continue
                </button>
              </div>

              
            </div>
          </div>
        )}
      </div>
    </>
  );
}
