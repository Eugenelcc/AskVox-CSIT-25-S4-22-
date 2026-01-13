
import { useEffect, useState } from "react";
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

export default function Quiz({
  open,
  onClose,
  messages,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  userId: string;
}) {


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

  // Current question (safe)
  const currentQ = questions[qIndex];

  // Compute title (NO HOOKS — prevents white screen crash)
  const computedTitle =
    mode === "A"
      ? "Quiz from Last Prompt"
      : mode === "B"
      ? `Quiz: ${topic.trim() || "Selected Topic"}`
      : "Quiz from Current Discussion";

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
  }, [open]);

  // If not open, render nothing
  if (!open) return null;

  /**
   * Generate quiz:
   * For now: fake questions (later replace with backend)
   */
  // ✅ Mode A: get last user message from the chat
const lastUserPrompt =
  [...messages]
    .reverse()
    .find((m) => m.senderId === userId)?.content?.trim() || "";

const handleGenerate = () => {
  // ✅ Only Mode A for now
  if (mode !== "A") {
    alert("For now we are only building Mode A 🙂");
    return;
  }

  if (!lastUserPrompt) {
    alert("No prompt found yet. Ask something in chat first.");
    return;
  }

  console.log("✅ Mode A last prompt:", lastUserPrompt);

  setQuizTitle("Quiz from Last Prompt");

  // TEMP: still fake questions, but now “linked” to prompt text
  const fake: QuizQuestion[] = [
    {
      id: "q1",
      q: `Based on your prompt: "${lastUserPrompt}", what is the main topic?`,
      options: ["Topic A", "Topic B", "Topic C", "Topic D"],
      answerIndex: 0,
    },
    {
      id: "q2",
      q: `Which of these would be a good follow-up question to: "${lastUserPrompt}"?`,
      options: ["Follow-up 1", "Follow-up 2", "Follow-up 3", "Follow-up 4"],
      answerIndex: 0,
    },
    {
      id: "q3",
      q: `What is one key keyword from your prompt?`,
      options: ["Keyword 1", "Keyword 2", "Keyword 3", "Keyword 4"],
      answerIndex: 0,
    },
  ];

  setQuestions(fake);
  setUserAnswers(new Array(fake.length).fill(null));
  setQIndex(0);
  setSelectedIndex(null);
  setIsSubmitted(false);
  setScore({ correct: 0, wrong: 0 });
  setStage("run");
};
  

  /**
   * Submit current question:
   * - lock the answer
   * - update score
   * - save the chosen option
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
   * - move to next question
   * - if finished -> results screen
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
   * - Before submit: only selected = grey + outline
   * - After submit:
   *    - correct = green
   *    - chosen wrong = red
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
      ? ["Understanding of key conflict concepts", "Good factual recall"]
      : ["Good effort — keep practicing"];

  const weakAreas =
    total > 0 && wrongCount / total >= 0.3
      ? ["Review the missed questions", "Practice more topic-based quizzes"]
      : ["Minor gaps — quick revision helps"];

  const recommended = "Generate an additional quiz to reinforce weak topics.";

  return (
    <div className="av-quizOverlay" onMouseDown={onClose}>
      <aside className="av-quizDrawer" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="av-quizHeader">
          <div className="av-quizHeaderTitle">Quiz</div>

          <button
            className="av-quizClose"
            onClick={onClose}
            type="button"
            aria-label="Close"
          >
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

              <div className="av-chooseActions">
                <button
                  className="av-generateBtn"
                  type="button"
                  onClick={handleGenerate}
                >
                  Generate Quiz
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
                        <span className="av-optLetter">
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span className="av-optText">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bottom buttons */}
              <div className="av-runActions">
                <button
                  type="button"
                  className="av-backBtn"
                  onClick={() => setStage("choose")}
                >
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
                  <button
                    type="button"
                    className="av-nextBtn"
                    onClick={handleNext}
                  >
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

                  <button
                    type="button"
                    className="av-secondaryBtn"
                    onClick={() => setStage("choose")}
                  >
                    New Quiz
                  </button>

                  <button
                    type="button"
                    className="av-secondaryBtn"
                    onClick={onClose}
                  >
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
