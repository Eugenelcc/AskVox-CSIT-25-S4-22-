import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";

import AskVoxLogo from "../../components/TopBars/AskVox.png";
import AskVoxStarBackground from "../../components/background/background";
import styles from "./payment.module.css";
import PaymentImage from "./card_stack.png";


/**
 * 🔧 CHANGE THIS PLACEHOLDER
 * Put image inside /public and update path
 * Example: /payment-card.png
 */
const PAYMENT_IMAGE = PaymentImage;

type BillingCycle = "monthly" | "yearly";

export default function payment() {
  const navigate = useNavigate();
  const location = useLocation();

  // If you passed cycle from Upgrade page: navigate("/payment", { state: { cycle } })
  const cycle = (location.state as any)?.cycle as BillingCycle | undefined;

  // Simple amount logic (edit to match your real pricing)
  const amount = useMemo(() => {
    if (cycle === "yearly") return 264; // example yearly paid
    return 22;
  }, [cycle]);

  // form states (UI only)
  const [cardNumber, setCardNumber] = useState("5264 **** **** 1267");
  const [holderName, setHolderName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");

  const goBack = () => navigate("/upgrade"); // or "/reguserhome" if you prefer
  const close = () => navigate("/reguserhome");

  const onPay = () => {
    // TODO: integrate Stripe / payment API
    // For now just route back or show success
    navigate("/payment-success", { state: { amount, cycle: cycle ?? "monthly" } });
  };

  return (
    <>
      <AskVoxStarBackground />

      <div className={styles.page}>
        {/* Logo top-left */}
        <button className={styles.logoBtn} onClick={close} aria-label="Back">
          <img src={AskVoxLogo} alt="AskVox" className={styles.logo} />
        </button>

        {/* X top-right */}
        <button className={styles.closeBtn} onClick={close} aria-label="Close">
          <X size={18} />
        </button>

        {/* Centered panel */}
        <div className={styles.panel}>
          {/* Left image card */}
          <div className={styles.leftCard}>
            <div
              className={styles.leftImage}
              style={{
                backgroundImage: PAYMENT_IMAGE ? `url(${PAYMENT_IMAGE})` : undefined,
              }}
            />
          </div>

          {/* Right form card */}
          <div className={styles.rightCard}>
            <h1 className={styles.heading}>
              Payment Details <span className={styles.sparkle}>✨</span>
            </h1>

            <label className={styles.label}>Card Number</label>
            <input
              className={styles.input}
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="5264 **** **** 1267"
            />

            <label className={styles.label}>Card Holder Name</label>
            <input
              className={styles.input}
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              placeholder="Enter your Full name..."
            />

            <div className={styles.row}>
              <div className={styles.col}>
                <label className={styles.label}>Expiry Date: *</label>
                <input
                  className={styles.inputSmall}
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  placeholder="mm / yy"
                />
              </div>

              <div className={styles.col}>
                <label className={styles.label}>CVV/CVV2: *</label>
                <input
                  className={styles.inputSmall}
                  value={cvv}
                  onChange={(e) => setCvv(e.target.value)}
                  placeholder="xxx"
                />
              </div>

              {/* Little toggle pill (your figma has a small capsule on the right) */}
              <div className={styles.colToggle}>
                <div className={styles.miniToggle} title="Demo toggle">
                  <span className={styles.miniDotLeft} />
                  <span className={styles.miniDotRight} />
                </div>
              </div>
            </div>

            <div className={styles.savedNote}>Card details are auto-saved</div>

            <div className={styles.totalRow}>
              <div className={styles.totalLabel}>Total Amount:</div>
              <div className={styles.totalValue}>
                ${amount}/{cycle === "yearly" ? "year" : "month"}
              </div>
            </div>

            <button className={styles.payBtn} onClick={onPay}>
              Pay ${amount}
            </button>

            {/* optional back link */}
            <button className={styles.backLink} onClick={goBack} type="button">
              ← Back to plans
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

  