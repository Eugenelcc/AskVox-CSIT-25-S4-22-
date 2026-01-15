import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import "./Quiz.css";
import type { ChatMessage } from "../../types/database";


/** A/B/C mode */
type QuizMode = "A" | "B" | "C";

/** Which screen we are on */
type Stage = "choose" | "run" | "result";

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
};

const API_BASE = "http://localhost:8000";

export default function Quiz({
  open,
  onClose,
  userId,
  sessionId,
  messages,
}: 
{
  open: boolean;
  onClose: () => void;
  userId: string;
  sessionId: string | null;
  messages: ChatMessage[];
}) 
{
  // ---------- Choose screen state ----------
  const [mode, setMode] = useState<QuizMode>("A");
  const [topic, setTopic] = useState("");

  // ---------- Quiz run state ----------
  const [stage, setStage] = useState<Stage>("choose");
  const [quizTitle, setQuizTitle] = useState("");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [qIndex, setQIndex] = useState(0);

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
    setSelectedIndex(null);
    setIsSubmitted(false);
    setScore({ correct: 0, wrong: 0 });
    setUserAnswers([]);
    setIsGenerating(false);
    setGenError(null);
  }, [open]);

  // If not open, render nothing
  if (!open) return null;

  const startQuizRun = (title: string, qs: QuizQuestion[]) => {
    setQuizTitle(title);
    setQuestions(qs);
    setUserAnswers(new Array(qs.length).fill(null));
    setQIndex(0);
    setSelectedIndex(null);
    setIsSubmitted(false);
    setScore({ correct: 0, wrong: 0 });
    setStage("run");
  };

  /**
   * Generate quiz:
   * Mode A only (backend)
   */
  const handleGenerate = async () => {
  setGenError(null);

  // ✅ Mode B needs a topic
  if (mode === "B" && !topic.trim()) {
    alert("Please enter a topic for Mode B 🙂");
    return;
  }

  // ✅ Mode C needs a sessionId (whole chat)
  if (mode === "C" && !sessionId) {
    alert("Mode C needs a chat session. Open/start a chat first 🙂");
    return;
  }

  // ✅ Optional UX guard:
  // Mode A expects you to have at least one prompt in the chat
  if (mode === "A" && !lastUserPrompt) {
    alert("No prompt found yet. Ask something in chat first, then generate quiz.");
    return;
  }

  try {
    setIsGenerating(true);

    const res = await fetch(`${API_BASE}/quiz/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode, // ✅ A / B / C
        user_id: userId,
        session_id: sessionId, // ✅ used by A(optional) + C(required)
        topic: mode === "B" ? topic.trim() : null, // ✅ used by B only
        num_questions: 3,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as Partial<GenerateQuizRes> & {
      detail?: string;
    };

    if (!res.ok) {
      throw new Error(data?.detail || `Quiz API failed (${res.status})`);
    }

    const title = String(data.title || "Quiz");
    const qs = Array.isArray(data.questions) ? data.questions : [];

    if (!qs.length) {
      throw new Error("Quiz API returned no questions.");
    }

    // ✅ Basic validation/cleanup (prevents weird model outputs)
    const cleaned: QuizQuestion[] = qs
      .map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        q: String(q.q || "").trim(),
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        answerIndex: typeof q.answerIndex === "number" ? q.answerIndex : 0,
      }))
      .filter((q) => q.q && q.options.length === 4 && q.answerIndex >= 0 && q.answerIndex <= 3);

    if (!cleaned.length) {
      throw new Error("Quiz API returned invalid question format.");
    }

    startQuizRun(title, cleaned);
  } catch (e: any) {
    console.error("❌ Quiz generate failed:", e);
    setGenError(e?.message || "Failed to generate quiz.");
  } finally {
    setIsGenerating(false);
  }
};

  /**
   * Submit current question:
  */
  const handleSubmitAnswer = () => {
    if (!currentQ) return;
    if (selectedIndex === null) return;

    setIsSubmitted(true);

    const correct = selectedIndex === currentQ.answerIndex;

    // Update score once per question
    setScore((s) => ({
      correct: s.correct + (correct ? 1 : 0),
      wrong: s.wrong + (correct ? 0 : 1),
    }));

    // Save the answer
    setUserAnswers((prev) => {
      const next = [...prev];
      next[qIndex] = selectedIndex;
      return next;
    });
  };

  /**
   * Next:
  */
  const handleNext = () => {
    const next = qIndex + 1;
    if (next >= questions.length) {
      setStage("result");
      return;
    }
    setQIndex(next);
    setSelectedIndex(null);
    setIsSubmitted(false);
  };

  /**
   * Option styling state:
  */
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

  // Basic results data (placeholder)
  const total = questions.length || 0;
  const correctCount = score.correct;
  const wrongCount = score.wrong;

  const strengths =
    total > 0 && correctCount / total >= 0.7
      ? ["Good recall", "Strong understanding"]
      : ["Good effort — keep practicing"];

  const weakAreas =
    total > 0 && wrongCount / total >= 0.3
      ? ["Review missed questions", "Try another quiz for reinforcement"]
      : ["Minor gaps — quick revision helps"];

  const recommended = "Generate another quiz to reinforce weak areas.";

  return (
    <div className="av-quizOverlay" onMouseDown={onClose}>
      <aside className="av-quizDrawer" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="av-quizHeader">
          <div className="av-quizHeaderTitle">Quiz</div>

          <button className="av-quizClose" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="av-quizBody">
          {/* ================= CHOOSE SCREEN ================= */}
          {stage === "choose" && (
            <div className="av-chooseCard">
              <div className="av-chooseCardHeader">Choose Your Quiz Type:</div>

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

              {/* small status box */}
              {genError && (
                <div style={{ marginTop: 10, opacity: 0.85, fontSize: 13 }}>
                  ❌ {genError}
                </div>
              )}

              <div className="av-chooseActions">
                <button
                  className="av-generateBtn"
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                >
                  {isGenerating ? "Generating..." : "Generate Quiz"}
                </button>
              </div>
            </div>
          )}

          {/* ================= RUN SCREEN ================= */}
          {stage === "run" && currentQ && (
            <div className="av-runCard">
              {/* Top info card */}
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

              {/* Question card */}
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
                          if (isSubmitted) return; // lock after submit
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

              {/* Bottom buttons */}
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
                </div>

                <div className="av-resultActions">
                  <button
                    type="button"
                    className="av-secondaryBtn"
                    onClick={() => {
                      // Retry same quiz
                      setQIndex(0);
                      setSelectedIndex(null);
                      setIsSubmitted(false);
                      setScore({ correct: 0, wrong: 0 });
                      setUserAnswers(new Array(questions.length).fill(null));
                      setStage("run");
                    }}
                  >
                    Retry
                  </button>

                  <button type="button" className="av-secondaryBtn" onClick={() => setStage("choose")}>
                    New Quiz
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

