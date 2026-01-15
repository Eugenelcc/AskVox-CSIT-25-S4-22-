import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X, CheckCircle2 } from "lucide-react";

import AskVoxLogo from "../../components/TopBars/AskVox.png";
import AskVoxStarBackground from "../../components/background/background";
import styles from "./payment.module.css"; // reuse layout styles
import { supabase } from "../../supabaseClient";

export default function InstituteVerification() {
  const navigate = useNavigate();
  const location = useLocation();
  const cycle = (location.state as any)?.cycle ?? "monthly";

  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [checkingPending, setCheckingPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Check for existing pending verification request and lock UI if present
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        setCheckingPending(true);
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const uid = userRes?.user?.id;
        if (!uid) {
          setHasPending(false);
          return;
        }

        const { data, error } = await supabase
          .from("education_verification_requests")
          .select("id,status")
          .eq("user_id", uid)
          .eq("status", "pending")
          .limit(1);
        if (error) throw error;
        if (!mounted) return;
        setHasPending((data?.length ?? 0) > 0);
      } catch (e) {
        // Non-fatal; allow submission attempt, but show error
        if (mounted) setError((e as any)?.message || "Failed to check pending requests");
      } finally {
        if (mounted) setCheckingPending(false);
      }
    };
    check();
    return () => { mounted = false; };
  }, []);


  const goBack = () => navigate("/upgrade");

  const onSubmit = async () => {
    if (hasPending) return; // lockout when pending exists
    if (!name || !domain || !contact || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) throw new Error("Please sign in to submit verification.");

      const payload = {
        user_id: uid,
        institute_name: name.trim(),
        email_domain: domain.trim().toLowerCase(),
        contact_person: contact.trim(),
        notes: notes.trim() || null,
        // status defaults to 'pending' on the DB
      };

      const { error } = await supabase
        .from("education_verification_requests")
        .insert(payload);
      if (error) throw error;

      setSubmitted(true);
      setHasPending(true); // keep UI locked post-submit
      setTimeout(() => navigate("/reguserhome"), 1500);
    } catch (e: any) {
      setError(e?.message || "Failed to submit verification request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <AskVoxStarBackground />
      <div className={styles.page}>
        <button className={styles.logoBtn} onClick={goBack} aria-label="Back">
          <img src={AskVoxLogo} alt="AskVox" className={styles.logo} />
        </button>
        <button className={styles.closeBtn} onClick={goBack} aria-label="Close">
          <X size={18} />
        </button>

        <div className={styles.panel}>
          <div className={styles.leftCard}>
            <div className={styles.leftImage} />
          </div>

          <div className={styles.rightCard}>
            <h1 className={styles.heading}>Educational Verification <span className={styles.sparkle}>✨</span></h1>
            <p style={{color:'#bbb', marginTop: 4}}>Provide your institute details. We will verify and reach out via email. Billing cycle: {cycle}.</p>

            <label className={styles.label} style={{marginTop: 16}}>Institute Name</label>
            <input className={styles.input} value={name} onChange={(e)=>setName(e.target.value)} placeholder="e.g., Springfield High School" disabled={hasPending || submitting} />

            <label className={styles.label}>Official Email Domain</label>
            <input className={styles.input} value={domain} onChange={(e)=>setDomain(e.target.value)} placeholder="e.g., school.edu" disabled={hasPending || submitting} />

            <label className={styles.label}>Contact Person</label>
            <input className={styles.input} value={contact} onChange={(e)=>setContact(e.target.value)} placeholder="Your name and role" disabled={hasPending || submitting} />

            <label className={styles.label}>Notes (optional)</label>
            <textarea className={styles.input} value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Any additional information" style={{height:120,paddingTop:12,paddingBottom:12}} disabled={hasPending || submitting}></textarea>

            <div style={{marginTop: 14}}>
              <button className={`${styles.payBtn} ${(!name || !domain || !contact || submitting || hasPending) ? styles.payBtnDisabled : ''}`} onClick={onSubmit} disabled={!name || !domain || !contact || submitting || hasPending}>
                {hasPending ? "Awaiting Verification" : "Submit for Verification"}
              </button>
              <button className={styles.backLink} onClick={goBack} style={{display:'block'}}>
                ← Back to plans
              </button>
            </div>

            {error && (
              <div style={{ marginTop: 10, color: '#ff8080', fontSize: 14 }}>{error}</div>
            )}

            {submitted && (
              <div className={styles.modalOverlay} role="alertdialog" aria-live="polite" onClick={()=>setSubmitted(false)}>
                <div className={styles.modal} onClick={(e)=>e.stopPropagation()}>
                  <div className={styles.modalIconWrap}><CheckCircle2 className={styles.modalIcon} size={28} /></div>
                  <div className={styles.modalTitle}>Request submitted</div>
                  <div className={styles.modalText}>We will contact you via your institute domain email.</div>
                  <div className={styles.modalActions}>
                    <button className={styles.modalBtnPrimary} onClick={()=>setSubmitted(false)}>Close</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
