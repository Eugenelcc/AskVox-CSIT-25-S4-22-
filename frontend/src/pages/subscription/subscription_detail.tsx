import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";

import AskVoxLogo from "../../components/TopBars/AskVox.png";
import AskVoxStarBackground from "../../components/background/background";
import styles from "./SubscriptionPlan.module.css";
import { supabase } from "../../supabaseClient";

type Plan = "free" | "paid" | "edu";
type BillingCycle = "monthly" | "yearly";

export default function Upgrade() {
  const navigate = useNavigate();

  // ✅ Demo default (replace with DB later)
  const [currentPlan] = useState<Plan>("free");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  const pricing = useMemo(() => {
    return {
      paid: cycle === "monthly" ? 22 : 264,
      edu: cycle === "monthly" ? 400 : 4800,
      suffix: cycle === "monthly" ? "/month" : "/year",
    };
  }, [cycle]);

  const goBack = () => navigate("/reguserhome");

  const onSelectPlan = async (plan: Plan) => {
    if (plan === currentPlan) return;

    if (plan === "paid") {
      navigate("/payment", { state: { cycle } });
      return;
    }

    if (plan === "edu") {
      try {
        const sess = (await supabase.auth.getSession()).data.session;
        const token = sess?.access_token as string | undefined;
        if (!token) throw new Error("Not authenticated");

        const resp = await fetch("http://localhost:8000/billing/education-status", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error(await resp.text());
        const out = await resp.json();
        if (out?.approved) {
          navigate("/payment", { state: { cycle, subscriptionType: "education" } });
        } else {
          navigate("/institute-verification", { state: { cycle } });
        }
      } catch {
        navigate("/institute-verification", { state: { cycle } });
      }
      return;
    }

    // free selected
    navigate("/downgrade-confirm", { state: { cycle } });
  };

  const isCurrent = (plan: Plan) => plan === currentPlan;

  // ✅ only 2 card styles now
  const cardClass = (plan: Plan) => {
    return [
      styles.card,
      isCurrent(plan) ? styles.currentPlanCard : styles.availablePlanCard,
    ].join(" ");
  };

  const renderButton = (plan: Plan) => {
    if (isCurrent(plan)) {
      return (
        <button className={styles.currentBtn} disabled>
          Your existing plan ✨
        </button>
      );
    }

    return (
      <button className={styles.chooseBtn} onClick={() => onSelectPlan(plan)}>
        Choose Plan
      </button>
    );
  };

  return (
    <>
      <AskVoxStarBackground />

      <div className={styles.page}>
        {/* Top left logo */}
        <button className={styles.logoBtn} onClick={goBack} aria-label="Back to Home">
          <img src={AskVoxLogo} alt="AskVox" className={styles.logo} />
        </button>

        {/* Top right close */}
        <button className={styles.closeBtn} onClick={goBack} aria-label="Close">
          <X size={18} />
        </button>

        {/* Title */}
        <h1 className={styles.title}>Pricing Plan</h1>

        {/* Toggle */}
        <div className={styles.toggleWrap}>
          <span className={styles.toggleLabel}>Monthly</span>

          <button
            className={styles.toggleBtn}
            onClick={() => setCycle((p) => (p === "monthly" ? "yearly" : "monthly"))}
            aria-label="Toggle billing cycle"
          >
            <span className={`${styles.knob} ${cycle === "yearly" ? styles.knobRight : ""}`} />
          </button>

          <span className={styles.toggleLabel}>Yearly</span>
        </div>

        {/* Cards */}
        <div className={styles.cards}>
          {/* Free */}
          <section className={cardClass("free")}>
            <div className={styles.cardInner}>
              <h2 className={styles.planName}>Free</h2>

              <div className={styles.priceRow}>
                <span className={styles.priceValue}>$0</span>
                <span className={styles.priceMeta}>USD{pricing.suffix}</span>
              </div>

              <ul className={styles.features}>
                <li>Core Chat Features</li>
                <li>Voice to Text Transcription</li>
                <li>Conversational AI (20 min/day)</li>
                <li>View Past Chats</li>
                <li>Interactive Quiz creation</li>
                <li>Upload limited documents & images</li>
                <li>Smart topic Recommendation</li>
                <li>Discover News interactively</li>
                <li>Web source integration</li>
                <li>Limited multimedia responses</li>
              </ul>

              <div className={styles.btnRow}>{renderButton("free")}</div>
            </div>
          </section>

          {/* Paid */}
          <section className={cardClass("paid")}>
            <div className={styles.cardInner}>
              <h2 className={styles.planName}>Paid</h2>

              <div className={styles.priceRow}>
                <span className={styles.priceValue}>${pricing.paid}</span>
                <span className={styles.priceMeta}>USD{pricing.suffix}</span>
              </div>

              <ul className={styles.features}>
                <li>Core Chat Features</li>
                <li>Voice to Text Transcription</li>
                <li>Conversational AI without limit</li>
                <li>View Past Chats</li>
                <li>Interactive Quiz creation</li>
                <li>Upload unlimited documents & images</li>
                <li>Customise chats & folders</li>
                <li>Smart topic Recommendation</li>
                <li>Discover News interactively</li>
                <li>Custom wake word</li>
                <li>Web source integration</li>
                <li>Unlimited multimedia responses</li>
              </ul>

              <div className={styles.btnRow}>{renderButton("paid")}</div>
            </div>
          </section>

          {/* Edu */}
          <section className={cardClass("edu")}>
            <div className={styles.cardInner}>
              <h2 className={styles.planName}>Educational Institutes</h2>

              <div className={styles.priceRow}>
                <span className={styles.priceValue}>${pricing.edu}</span>
                <span className={styles.priceMeta}>USD{pricing.suffix}</span>
              </div>

              <div className={styles.eduText}>
                Upload documents to AI Checker to verify the source of any text and prevent misuse or plagiarism
                of AI-generated content.
                <div className={styles.eduNote}>*Verification of institutes is required.*</div>
              </div>

              <div className={styles.btnRow}>{renderButton("edu")}</div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
