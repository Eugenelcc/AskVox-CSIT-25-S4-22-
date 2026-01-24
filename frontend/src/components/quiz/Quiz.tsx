import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import "./Quiz.css";
import type { ChatMessage } from "../../types/database";
import { supabase } from "../../supabaseClient";

/** A/B/C mode */
type QuizMode = "A" | "B" | "C";

/** Which screen we are on */
type Stage = "choose" | "run" | "result" | "history" | "review"; // ✅ ADDED

/** One quiz question */
type QuizQuestion = {
  id: string;
  q: string;
  options: string[];
  answerIndex: number; // index of correct option
};

type GenerateQuizRes = {
  title: string;
  questions: QuizQuestion[];
  quiz_id?: string;
};

// ✅ feedback response type
type FeedbackRes = {
  strengths: string[];
  weakAreas: string[];
  recommended: string;
};

// ✅ ADDED: History Types (UI-first)
type QuizHistoryItem = {
  attemptId: string;
  title: string;
  topic?: string | null;
  quizType?: QuizMode;
  scoreCorrect: number;
  total: number;
  createdAt: string;
};

type QuizHistoryDetail = {
  attemptId: string;
  title: string;
  topic?: string | null;
  quizType?: QuizMode;
  createdAt: string;
  questions: QuizQuestion[];
  userAnswers: Array<number | null>;
  feedback: FeedbackRes | null;
  scoreCorrect: number;
  total: number;
};

const API_BASE = import.meta.env.VITE_API_URL;

// ✅ UI-only mock history (replace later with real DB)
// const MOCK_HISTORY: QuizHistoryDetail[] = [
//   {
//     attemptId: "a1",
//     title: "Quiz: Dwarf Planets",
//     topic: "Planets",
//     quizType: "B",
//     createdAt: "Just now",
//     questions: [
//       {
//         id: "q1",
//         q: "What is a dwarf planet?",
//         options: ["A small star", "A minor planet", "A gas giant", "A comet"],
//         answerIndex: 1,
//       },
//       {
//         id: "q2",
//         q: "Which is a dwarf planet?",
//         options: ["Earth", "Jupiter", "Pluto", "Mars"],
//         answerIndex: 2,
//       },
//       {
//         id: "q3",
//         q: "Dwarf planets have not ____.",
//         options: ["an orbit", "cleared orbit", "gravity", "moons"],
//         answerIndex: 1,
//       },
//     ],
//     userAnswers: [1, 2, 0],
//     feedback: {
//       strengths: ["Understands dwarf planet definition", "Identifies known dwarf planets"],
//       weakAreas: ["Distinguishing orbit-clearing rule", "Planet vs dwarf planet criteria"],
//       recommended: "Review the orbit-clearing criterion, then retry a dwarf-planet quiz.",
//     },
//     scoreCorrect: 2,
//     total: 3,
//   },
// ];

export default function Quiz({
  open,
  onClose,
  userId,
  sessionId,
  messages,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  sessionId: string | null;
  messages: ChatMessage[];
}) {
  // ---------- Choose screen state ----------
  const [mode, setMode] = useState<QuizMode>("A");
  const [topic, setTopic] = useState("");

  // ---------- Quiz run state ----------
  const [stage, setStage] = useState<Stage>("choose");
  const [quizTitle, setQuizTitle] = useState("");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [quizId, setQuizId] = useState<string | null>(null);

  // Which option user clicked (before submit)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Has user submitted this question? (after submit -> show correct/wrong colors)
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Track score
  const [score, setScore] = useState({ correct: 0, wrong: 0 });

  // Track answers across all questions (so results can be computed later)
  const [userAnswers, setUserAnswers] = useState<Array<number | null>>([]);

  // Loading/Error (for backend call)
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // feedback + loading state
  const [feedback, setFeedback] = useState<FeedbackRes | null>(null);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);

  // ✅ ADDED: history UI state (NO extra hooks)
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyItems, setHistoryItems] = useState<QuizHistoryItem[]>([]);
  const [activeReview, setActiveReview] = useState<QuizHistoryDetail | null>(null);

  // 3s notice banner (replaces alerts/inline prompt)
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3000);
  };

  // Current question (safe)
  const currentQ = questions[qIndex];

  // Mode A: last user message (for UX check only)
  const lastUserPrompt = useMemo(() => {
    return (
      [...(messages ?? [])]
        .reverse()
        .find((m) => m.senderId === userId)?.content?.trim() || ""
    );
  }, [messages, userId]);

  // Reset EVERYTHING each time modal opens
  useEffect(() => {
    if (!open) return;

    setMode("A");
    setTopic("");
    setStage("choose");
    setQuizTitle("");
    setQuestions([]);
    setQIndex(0);
    setQuizId(null);
    setSelectedIndex(null);
    setIsSubmitted(false);
    setScore({ correct: 0, wrong: 0 });
    setUserAnswers([]);
    setIsGenerating(false);
    setGenError(null);

    setFeedback(null);
    setIsFeedbackLoading(false);

    // ✅ history reset
    setHistoryQuery("");
    setHistoryItems([]);
    setActiveReview(null);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice(null);
  }, [open]);

  // ✅ IMPORTANT: keep early return AFTER all hooks, and NO hooks below it
  if (!open) return null;

  const startQuizRun = (title: string, qs: QuizQuestion[]) => {
    setQuizTitle(title);
    setQuestions(qs);
    setUserAnswers(new Array(qs.length).fill(null));
    setQIndex(0);
    setSelectedIndex(null);
    setIsSubmitted(false);
    setScore({ correct: 0, wrong: 0 });

    setFeedback(null);
    setIsFeedbackLoading(false);

    setStage("run");
  };

  const handleGenerate = async () => {
    setGenError(null);

    if (mode === "B" && !topic.trim()) {
      alert("Please enter a topic for Mode B 🙂");
      return;
    }

    if (mode === "C") {
      if (!sessionId) { showNotice("Open/Start a new chat first 🙂"); return; }
      if (!lastUserPrompt) { showNotice("Open/Start a new chat first 🙂"); return; }
    }

    if (mode === "A") {
      if (!sessionId) { showNotice("Open/Start a new chat first 🙂"); return; }
      if (!lastUserPrompt) { showNotice("Open/Start a new chat first 🙂"); return; }
    }

    try {
      setIsGenerating(true);

      const res = await fetch(`${API_BASE}/quiz/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          user_id: userId,
          session_id: sessionId,
          topic: mode === "B" ? topic.trim() : null,
          num_questions: 3,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as Partial<GenerateQuizRes> & { detail?: string };

      if (!res.ok) throw new Error(data?.detail || `Quiz API failed (${res.status})`);

      const title = String(data.title || "Quiz");
      const qs = Array.isArray(data.questions) ? data.questions : [];
      if (!qs.length) throw new Error("Quiz API returned no questions.");

      const cleaned: QuizQuestion[] = qs
        .map((q: any, i: number) => ({
          id: String(q.id || `q${i + 1}`),
          q: String(q.q || "").trim(),
          options: Array.isArray(q.options) ? q.options.map(String) : [],
          answerIndex: typeof q.answerIndex === "number" ? q.answerIndex : 0,
        }))
        .filter((q) => q.q && q.options.length === 4 && q.answerIndex >= 0 && q.answerIndex <= 3);

      if (!cleaned.length) throw new Error("Quiz API returned invalid question format.");

      // capture quiz id for feedback/attempt storage
      const qid = typeof data.quiz_id === "string" && data.quiz_id.length ? data.quiz_id : null;
      setQuizId(qid);

      startQuizRun(title, cleaned);
    } catch (e: any) {
      console.error("❌ Quiz generate failed:", e);
      setGenError(e?.message || "Failed to generate quiz.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateRelated = async () => {
    setGenError(null);

    // Reuse the same validation as handleGenerate based on current mode
    if (mode === "B" && !topic.trim()) {
      alert("Please enter a topic for Mode B 🙂");
      return;
    }
    if (mode === "A") {
      if (!sessionId) { showNotice("Open/Start a new chat first 🙂"); return; }
      if (!lastUserPrompt) { showNotice("Open/Start a new chat first 🙂"); return; }
    }
    if (mode === "C") {
      if (!sessionId) { showNotice("Open/Start a new chat first 🙂"); return; }
      if (!lastUserPrompt) { showNotice("Open/Start a new chat first 🙂"); return; }
    }

    try {
      setIsGenerating(true);

      const res = await fetch(`${API_BASE}/quiz/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          user_id: userId,
          session_id: sessionId,
          topic: mode === "B" ? topic.trim() : null,
          num_questions: 3,
          avoid_questions: (questions || []).map((q) => q.q),
          related: true,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as Partial<GenerateQuizRes> & { detail?: string };
      if (!res.ok) throw new Error(data?.detail || `Quiz API failed (${res.status})`);

      const title = String(data.title || "Quiz");
      const qs = Array.isArray(data.questions) ? data.questions : [];
      if (!qs.length) throw new Error("Quiz API returned no questions.");

      const cleaned: QuizQuestion[] = qs
        .map((q: any, i: number) => ({
          id: String(q.id || `q${i + 1}`),
          q: String(q.q || "").trim(),
          options: Array.isArray(q.options) ? q.options.map(String) : [],
          answerIndex: typeof q.answerIndex === "number" ? q.answerIndex : 0,
        }))
        .filter((q) => q.q && q.options.length === 4 && q.answerIndex >= 0 && q.answerIndex <= 3);

      if (!cleaned.length) throw new Error("Quiz API returned invalid question format.");

      const qid = typeof data.quiz_id === "string" && data.quiz_id.length ? data.quiz_id : null;
      setQuizId(qid);

      startQuizRun(title, cleaned);
    } catch (e: any) {
      console.error("❌ Related quiz generate failed:", e);
      setGenError(e?.message || "Failed to generate related quiz.");
    } finally {
      setIsGenerating(false);
    }
  };

  // (no inline flow; using 3s notice instead)

  const handleSubmitAnswer = () => {
    if (!currentQ) return;
    if (selectedIndex === null) return;

    setIsSubmitted(true);

    const correct = selectedIndex === currentQ.answerIndex;

    setScore((s) => ({
      correct: s.correct + (correct ? 1 : 0),
      wrong: s.wrong + (correct ? 0 : 1),
    }));

    setUserAnswers((prev) => {
      const next = [...prev];
      next[qIndex] = selectedIndex;
      return next;
    });
  };

  const fetchQuizFeedback = async (finalAnswers: Array<number | null>) => {
    setIsFeedbackLoading(true);
    try {
      const res = await fetch(`${API_BASE}/quiz/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: quizTitle,
          questions,
          userAnswers: finalAnswers,
          user_id: userId,
          quiz_id: quizId,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as Partial<FeedbackRes> & { detail?: string };
      if (!res.ok) throw new Error(data?.detail || `Feedback API failed (${res.status})`);

      const strengths = Array.isArray(data.strengths) ? data.strengths.map(String).slice(0, 4) : [];
      const weakAreas = Array.isArray(data.weakAreas) ? data.weakAreas.map(String).slice(0, 4) : [];
      const recommended = String(data.recommended || "").trim();

      setFeedback({ strengths, weakAreas, recommended });
    } catch (e) {
      console.warn("⚠️ Feedback failed, will show fallback.", e);
      setFeedback(null);
    } finally {
      setIsFeedbackLoading(false);
    }
  };

  const handleNext = () => {
    const next = qIndex + 1;

    if (next >= questions.length) {
      const finalAnswers = [...userAnswers];
      finalAnswers[qIndex] = selectedIndex;

      setStage("result");
      fetchQuizFeedback(finalAnswers);
      return;
    }

    setQIndex(next);
    setSelectedIndex(null);
    setIsSubmitted(false);
  };

  const getOptionState = (optIndex: number) => {
    if (!currentQ) return "default";

    if (!isSubmitted) {
      return selectedIndex === optIndex ? "selected" : "default";
    }

    const isCorrect = optIndex === currentQ.answerIndex;
    const isChosen = optIndex === selectedIndex;

    if (isCorrect) return "correct";
    if (isChosen && !isCorrect) return "wrong";
    return "default";
  };

  // ✅ Review option state (read-only)
  const getReviewOptionState = (q: QuizQuestion, optIndex: number, chosen: number | null) => {
    const isCorrect = optIndex === q.answerIndex;
    const isChosen = chosen === optIndex;
    if (isCorrect) return "correct";
    if (isChosen && !isCorrect) return "wrong";
    return "default";
  };

  // Results data
  const total = questions.length || 0;
  const correctCount = score.correct;
  const wrongCount = score.wrong;

  const fallbackStrengths =
    total > 0 && correctCount / total >= 0.7
      ? ["Good recall", "Strong understanding"]
      : ["Good effort — keep practicing"];

  const fallbackWeakAreas =
    total > 0 && wrongCount / total >= 0.3
      ? ["Review missed questions", "Try another quiz for reinforcement"]
      : ["Minor gaps — quick revision helps"];

  const strengths = feedback?.strengths?.length ? feedback.strengths : fallbackStrengths;
  const weakAreas = feedback?.weakAreas?.length ? feedback.weakAreas : fallbackWeakAreas;
  const recommended =
    feedback?.recommended?.length ? feedback.recommended : "Generate another quiz to reinforce weak areas.";

  // ✅ HISTORY actions (no hooks)
  const openHistory = async () => {
    // Fetch attempts for this user from Supabase and join basic quiz info
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select("id, created_at, score, quizzes ( id, title, topic, mode )")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Quiz history load failed:", error.message);
    }

    const attempts = (data ?? []).map((row: any) => {
      const q = row?.quizzes || {};
      const created = row?.created_at ? new Date(row.created_at) : null;
      // Show only date (remove time-of-day)
      const createdText = created ? created.toLocaleDateString() : "";
      const total = questions?.length || 3; // fallback until totals are stored
      return {
        attemptId: String(row.id),
        title: String(q.title || "Quiz"),
        topic: q.topic ?? null,
        quizType: (q.mode as QuizMode) ?? undefined,
        scoreCorrect: Number.isFinite(row.score) ? Number(row.score) : 0,
        total,
        createdAt: createdText,
      } as QuizHistoryItem;
    });

    setHistoryItems(attempts);
    setHistoryQuery("");
    setActiveReview(null);
    setQIndex(0);
    setStage("history");
  };

  const openReview = async (attemptId: string) => {
    try {
      const res = await fetch(`${API_BASE}/quiz/attempt/${attemptId}`);
      const detail = (await res.json()) as QuizHistoryDetail;
      if (!res.ok || !detail?.attemptId) throw new Error("Load review failed");
      setActiveReview(detail);
      setQIndex(0);
      setStage("review");
    } catch (e) {
      alert("Unable to load review. Please try again later.");
    }
  };

  // ✅ Filter without useMemo (so no extra hooks)
  const filteredHistory = (() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return historyItems;
    return historyItems.filter((h) => {
      return (
        h.title.toLowerCase().includes(q) ||
        (h.topic || "").toLowerCase().includes(q) ||
        String(h.quizType || "").toLowerCase().includes(q)
      );
    });
  })();

  const reviewQ = activeReview?.questions?.[qIndex] || null;
  const reviewChosen = activeReview?.userAnswers?.[qIndex] ?? null;

  return (
    <div className="av-quizOverlay" onMouseDown={onClose}>
      <aside className="av-quizDrawer" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="av-quizHeader">
          <div className="av-quizHeaderTitle">Quiz</div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="av-secondaryBtn"
              style={{ width: "auto", padding: "8px 12px", borderRadius: 12 }}
              onClick={openHistory}
            >
              Quiz History
            </button>

            <button className="av-quizClose" onClick={onClose} type="button" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="av-quizBody">
          {/* ================= HISTORY SCREEN ================= */}
          {stage === "history" && (
            <div className="av-chooseCard" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Quiz History</div>
                <button type="button" className="av-secondaryBtn" onClick={() => setStage("choose")}>
                  Back
                </button>
              </div>

              <div className="av-topicBox" style={{ borderTop: "none", padding: "12px 0" }}>
                <div className="av-topicLabel">Search by topic / title</div>
                <input
                  className="av-topicInput"
                  value={historyQuery}
                  onChange={(e) => setHistoryQuery(e.target.value)}
                  placeholder="e.g. planets, ww2, geography"
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                {filteredHistory.length === 0 ? (
                  <div style={{ opacity: 0.8, fontSize: 13 }}>No quizzes found.</div>
                ) : (
                  filteredHistory.map((h) => (
                    <div
                      key={h.attemptId}
                      style={{
                        background: "#202020",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.06)",
                        padding: 12,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 14,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {h.title}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                          {h.topic ? `Topic: ${h.topic} · ` : ""}
                          {h.quizType ? `Mode: ${h.quizType} · ` : ""}
                          Score: {h.scoreCorrect}/{h.total} · {h.createdAt}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                        <button
                          type="button"
                          className="av-secondaryBtn"
                          style={{ width: 110 }}
                          onClick={() => openReview(h.attemptId)}
                        >
                          Review
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ================= REVIEW SCREEN ================= */}
          {stage === "review" && activeReview && reviewQ && (
            <div className="av-runCard">
              <div className="av-runHeaderCard">
                <div className="av-runTitle">{activeReview.title}</div>

                <div className="av-runMeta">
                  <div className="av-runProgress">
                    {qIndex + 1}/{activeReview.questions.length}
                  </div>
                  <div className="av-runScore">
                    <span className="ok">✅ {activeReview.scoreCorrect}</span>
                    <span className="bad">❌ {activeReview.total - activeReview.scoreCorrect}</span>
                  </div>
                </div>

                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
                  {activeReview.topic ? `Topic: ${activeReview.topic} · ` : ""}
                  {activeReview.quizType ? `Mode: ${activeReview.quizType} · ` : ""}
                  {activeReview.createdAt}
                </div>
              </div>

              <div className="av-qCard">
                <div className="av-qBar">
                  <div className="av-qText">
                    {qIndex + 1}. {reviewQ.q}
                  </div>
                </div>

                <div className="av-options">
                  {reviewQ.options.map((opt, idx) => {
                    const state = getReviewOptionState(reviewQ, idx, reviewChosen);

                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`av-optionRow av-optionRow--${state}`}
                        onClick={() => {}}
                        style={{ cursor: "default" }}
                      >
                        <span className="av-optLetter">{String.fromCharCode(65 + idx)}</span>
                        <span className="av-optText">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="av-runActions">
                <button
                  type="button"
                  className="av-nextBtn"
                  onClick={() => setQIndex((i) => Math.max(0, i - 1))}
                  disabled={qIndex === 0}
                >
                  Prev
                </button>

                <button
                  type="button"
                  className="av-nextBtn"
                  onClick={() => setQIndex((i) => Math.min(activeReview.questions.length - 1, i + 1))}
                  disabled={qIndex >= activeReview.questions.length - 1}
                >
                  Next
                </button>
              </div>

              <div className="av-resultCard" style={{ marginTop: 12 }}>
                <div className="av-resultLabel">Strengths:</div>
                <ul className="av-resultList">
                  {(activeReview.feedback?.strengths || ["(No feedback saved)"]).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>

                <div className="av-resultLabel" style={{ marginTop: 12 }}>
                  Weak Areas:
                </div>
                <ul className="av-resultList">
                  {(activeReview.feedback?.weakAreas || []).length ? (
                    activeReview.feedback!.weakAreas.map((w, i) => <li key={i}>{w}</li>)
                  ) : (
                    <li>(No feedback saved)</li>
                  )}
                </ul>

                <div className="av-resultLabel" style={{ marginTop: 12 }}>
                  Recommended:
                </div>
                <div className="av-resultSmall">
                  {activeReview.feedback?.recommended || "(No recommendation saved)"}
                </div>
              </div>
            </div>
          )}

          {/* ✅ REVIEW FALLBACK: show feedback-only when no per-question answers are available */}
          {stage === "review" && activeReview && !reviewQ && (
            <div className="av-runCard">
              <div className="av-runHeaderCard">
                <div className="av-runTitle">{activeReview.title}</div>

                <div className="av-runMeta">
                  <div className="av-runProgress">{activeReview.scoreCorrect}/{activeReview.total}</div>
                  <div className="av-runScore">
                    <span className="ok">✅ {activeReview.scoreCorrect}</span>
                    <span className="bad">❌ {Math.max(0, (activeReview.total || 0) - (activeReview.scoreCorrect || 0))}</span>
                  </div>
                </div>

                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
                  {activeReview.topic ? `Topic: ${activeReview.topic} · ` : ""}
                  {activeReview.quizType ? `Mode: ${activeReview.quizType} · ` : ""}
                  {activeReview.createdAt}
                </div>
              </div>

              <div className="av-resultCard" style={{ marginTop: 12 }}>
                <div className="av-resultSmall" style={{ marginBottom: 8, opacity: 0.85 }}>
                  No detailed answers were stored for this attempt.
                </div>

                <div className="av-resultLabel">Strengths:</div>
                <ul className="av-resultList">
                  {(activeReview.feedback?.strengths || ["(No feedback saved)"]).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>

                <div className="av-resultLabel" style={{ marginTop: 12 }}>
                  Weak Areas:
                </div>
                <ul className="av-resultList">
                  {(activeReview.feedback?.weakAreas || []).length ? (
                    activeReview.feedback!.weakAreas.map((w, i) => <li key={i}>{w}</li>)
                  ) : (
                    <li>(No feedback saved)</li>
                  )}
                </ul>

                <div className="av-resultLabel" style={{ marginTop: 12 }}>
                  Recommended:
                </div>
                <div className="av-resultSmall">
                  {activeReview.feedback?.recommended || "(No recommendation saved)"}
                </div>
              </div>

              <div className="av-runActions">
                <button type="button" className="av-backBtn" onClick={() => setStage("history")}>Back</button>
              </div>
            </div>
          )}

          {/* ================= CHOOSE SCREEN ================= */}
          {stage === "choose" && (
            <div className="av-chooseCard">
              <div className="av-chooseCardHeader">Choose Your Quiz Type:</div>

              {notice && (
                <div style={{
                  margin: "10px 0 14px",
                  padding: 12,
                  borderRadius: 10,
                  background: "rgba(255,149,28,0.12)",
                  border: "1px solid rgba(255,149,28,0.30)",
                  color: "#ffd6a0",
                  fontSize: 13,
                }} role="alert">
                  {notice}
                </div>
              )}

              <button
                className={`av-choiceRow ${mode === "A" ? "active" : ""}`}
                onClick={() => setMode("A")}
                type="button"
              >
                <span className="letter">A</span>
                <span>Quiz Based on Current Prompt (last query only)</span>
              </button>

              <button
                className={`av-choiceRow ${mode === "B" ? "active" : ""}`}
                onClick={() => setMode("B")}
                type="button"
              >
                <span className="letter">B</span>
                <span>Quiz from selected Topic (e.g., Geography, History)</span>
              </button>

              <button
                className={`av-choiceRow ${mode === "C" ? "active" : ""}`}
                onClick={() => setMode("C")}
                type="button"
              >
                <span className="letter">C</span>
                <span>Quiz for Current Discussion (entire chat)</span>
              </button>

              {mode === "B" && (
                <div className="av-topicBox">
                  <div className="av-topicLabel">Topic</div>
                  <input
                    className="av-topicInput"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. World War II"
                  />
                </div>
              )}

              {genError && (
                <div style={{ marginTop: 10, opacity: 0.85, fontSize: 13 }}>
                  ❌ {genError}
                </div>
              )}

              <div className="av-chooseActions">
                <button className="av-generateBtn" type="button" onClick={handleGenerate} disabled={isGenerating}>
                  {isGenerating ? "Generating..." : "Generate Quiz"}
                </button>
              </div>
            </div>
          )}

          {/* ================= RUN SCREEN ================= */}
          {stage === "run" && currentQ && (
            <div className="av-runCard">
              <div className="av-runHeaderCard">
                <div className="av-runTitle">{quizTitle}</div>

                <div className="av-runMeta">
                  <div className="av-runProgress">
                    {qIndex + 1}/{questions.length}
                  </div>
                  <div className="av-runScore">
                    <span className="ok">✅ {score.correct}</span>
                    <span className="bad">❌ {score.wrong}</span>
                  </div>
                </div>
              </div>

              <div className="av-qCard">
                <div className="av-qBar">
                  <div className="av-qText">
                    {qIndex + 1}. {currentQ.q}
                  </div>
                </div>

                <div className="av-options">
                  {currentQ.options.map((opt, idx) => {
                    const state = getOptionState(idx);

                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`av-optionRow av-optionRow--${state}`}
                        onClick={() => {
                          if (isSubmitted) return;
                          setSelectedIndex(idx);
                        }}
                      >
                        <span className="av-optLetter">{String.fromCharCode(65 + idx)}</span>
                        <span className="av-optText">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="av-runActions">
                <button type="button" className="av-backBtn" onClick={() => setStage("choose")}>
                  New Quiz
                </button>

                {!isSubmitted ? (
                  <button
                    type="button"
                    className="av-submitBtn"
                    disabled={selectedIndex === null}
                    onClick={handleSubmitAnswer}
                  >
                    Submit
                  </button>
                ) : (
                  <button type="button" className="av-nextBtn" onClick={handleNext}>
                    Next
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ================= RESULT SCREEN ================= */}
          {stage === "result" && (
            <div className="av-resultCard">
              <div className="av-resultTop">
                <div className="av-resultScore">
                  Your Score: {correctCount}/{total}
                </div>
              </div>

              <div className="av-resultCols">
                <div className="av-resultBlock">
                  {isFeedbackLoading ? (
                    <div className="av-resultSmall" style={{ opacity: 0.85 }}>
                      Generating personalised feedback...
                    </div>
                  ) : (
                    <>
                      <div className="av-resultLabel">Strengths:</div>
                      <ul className="av-resultList">
                        {strengths.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>

                      <div className="av-resultLabel" style={{ marginTop: 12 }}>
                        Weak Areas:
                      </div>
                      <ul className="av-resultList">
                        {weakAreas.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>

                      <div className="av-resultLabel" style={{ marginTop: 12 }}>
                        Recommended:
                      </div>
                      <div className="av-resultSmall">{recommended}</div>
                    </>
                  )}
                </div>

                <div className="av-resultActions">
                  <button
                    type="button"
                    className="av-secondaryBtn"
                    onClick={() => {
                      setQIndex(0);
                      setSelectedIndex(null);
                      setIsSubmitted(false);
                      setScore({ correct: 0, wrong: 0 });
                      setUserAnswers(new Array(questions.length).fill(null));
                      setFeedback(null);
                      setIsFeedbackLoading(false);
                      setStage("run");
                    }}
                  >
                    Retry
                  </button>

                  <button
                    type="button"
                    className="av-secondaryBtn"
                    onClick={handleGenerateRelated}
                    disabled={isGenerating}
                  >
                    {isGenerating ? "Generating..." : "New Quiz"}
                  </button>

                  <button type="button" className="av-secondaryBtn" onClick={onClose}>
                    End Quiz
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
