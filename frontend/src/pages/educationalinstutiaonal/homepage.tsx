import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import styles from "./homepage.module.css"
import NavRail from "../../components/Sidebar/NavRail"
import * as pdfjsLib from "pdfjs-dist"
import pdfWorker from "pdfjs-dist/build/pdf.worker?url"
import { supabase } from "../../lib/supabaseClient" // ✅ ADD

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

// helper to render PDF first page as image
const renderPdfPreview = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(1)

  const viewport = page.getViewport({ scale: 1.3 })
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")!

  canvas.width = viewport.width
  canvas.height = viewport.height

  await page.render({ canvasContext: context, viewport }).promise
  return canvas.toDataURL("image/png")
}

const EducationalHomepage = () => {
  const [text, setText] = useState("")
  const [showResults, setShowResults] = useState(false)
  const navigate = useNavigate() // ✅ ADD

  // upload preview state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [previewText, setPreviewText] = useState("")
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)

  // AI detection results
  const [aiPercentage, setAiPercentage] = useState(80)
  const [humanPercentage, setHumanPercentage] = useState(20)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisDetails, setAnalysisDetails] = useState<{ cyrillic_count: number; zero_width_count: number; thin_spaces_count: number; total_markers: number; text_length: number } | null>(null)

  // ✅ ADD: user profile state
  const [userRole, setUserRole] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  
  //Button for log out
  const handleLogout = async () => {
  await supabase.auth.signOut()
  navigate("/login")
  }

  // ✅ ADD: load Supabase user + role
  useEffect(() => {
    const loadProfile = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) return

      const { data, error } = await supabase
        .from("profiles")
        .select("username, role")
        .eq("id", session.user.id)
        .single()

      if (error) {
        console.error("Profile load error:", error)
        return
      }

      setUserName(data.username)
      setUserRole(data.role)
    }

    loadProfile()
  }, [])

  const wordCount =
    text.trim() === "" ? 0 : text.trim().split(/\s+/).length

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type.startsWith("image/")) {
      setPreviewImageUrl(URL.createObjectURL(file))
    } else if (file.type === "application/pdf") {
      const pdfPreview = await renderPdfPreview(file)
      setPreviewImageUrl(pdfPreview)
    } else {
      setPreviewImageUrl(null)
    }

    setUploadedFile(file)

    const formData = new FormData()
    formData.append("file", file)

    try {
      const res = await fetch("http://localhost:5000/extract-text", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) return alert("Failed to extract text")

      const data = await res.json()
      if (data.error) return alert(data.error)

      setPreviewText(data.text || "")
      setText(data.text || "")
      setShowResults(false)
    } catch (err) {
      console.error(err)
      alert("File upload failed")
    }
  }

  const handleAnalyze = async () => {
    if (!text.trim()) return

    setAnalyzing(true)
    try {
      const res = await fetch("http://localhost:8000/watermark/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text }),
      })

      if (!res.ok) {
        console.error("Analysis failed")
        // Use default values on error
        setAiPercentage(20)
        setHumanPercentage(80)
        setAnalysisDetails(null)
      } else {
        const data = await res.json()
        setAiPercentage(data.ai_percentage)
        setHumanPercentage(data.human_percentage)
        setAnalysisDetails(data.details ?? null)
      }
    } catch (err) {
      console.error(err)
      // Use default values on error
      setAiPercentage(20)
      setHumanPercentage(80)
      setAnalysisDetails(null)
    } finally {
      setAnalyzing(false)
      setShowResults(true)
    }
  }

  return (
    <div className={styles.page}>
      <NavRail activeTab="checker" onTabClick={() => {}} mode="educational" />

      <main className={styles.main}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleLogout}
          style={{
            background: "transparent",
            border: "1px solid #ccc",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Log out
        </button>
      </div>

        <h1 className={styles.title}>
          AskVox <span>AI Detector</span>
        </h1>

        {/* ✅ OPTIONAL: proves Supabase works */}
        {userName && (
          <p className={styles.subtitle}>
            Welcome back, {userName}
            {userRole === "educational_user" && " (Educational User)"}
            {userRole === "platform_admin" && " (Admin)"}
          </p>
        )}


        {!showResults ? (
          <section className={styles.card}>
            {uploadedFile && (
              <div className={styles.uploadedDocumentContainer}>
                <div className={styles.documentPreview}>
                  {previewImageUrl ? (
                    <img
                      src={previewImageUrl}
                      alt="Uploaded preview"
                      className={styles.previewImage}
                    />
                  ) : (
                    <div className={styles.documentPlaceholder}>
                      <span>{uploadedFile.name}</span>
                    </div>
                  )}
                </div>

                <div className={styles.documentDetails}>
                  <div className={styles.fileBadge}>
                    {uploadedFile.name}
                    <span>
                      {uploadedFile.type.includes("pdf")
                        ? "PDF"
                        : uploadedFile.type.includes("image")
                        ? "IMAGE"
                        : "DOCUMENT"}
                    </span>
                  </div>

                  <h4>Extracted Preview Text:</h4>
                  <p>
                    {previewText.slice(0, 600)}
                    {previewText.length > 600 && "..."}
                  </p>
                </div>
              </div>
            )}

            {!uploadedFile && (
              <>
                <header className={styles.cardHeader}>
                  <span>Enter your text:</span>
                  <span>{wordCount} words</span>
                </header>

                <textarea
                  className={styles.textarea}
                  placeholder="Paste/type your text here..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </>
            )}

            <div className={styles.actions}>
              <input
                type="file"
                accept=".pdf,.docx,.png,.jpg,.jpeg"
                id="fileUpload"
                hidden
                onChange={handleFileUpload}
              />

              <button
                className={styles.uploadBtn}
                onClick={() =>
                  document.getElementById("fileUpload")?.click()
                }
              >
                Upload Document
              </button>

              <button
                className={styles.submitBtn}
                onClick={handleAnalyze}
                disabled={!text.trim() || analyzing}
              >
                {analyzing ? "Analyzing..." : "Submit for Analysis"}
              </button>
            </div>
          </section>
        ) : (
          <section className={styles.resultsGrid}>
            <div className={styles.resultCard}>
              <header className={styles.cardHeader}>
                <span>Analyzed text:</span>
                <span>{wordCount} words</span>
              </header>

              <div className={styles.analyzedText}>{text}</div>

              <div className={styles.complete}>● Analysis Complete</div>

              {analysisDetails && (
                <div className={styles.detailsBox}>
                  <div>Markers found:</div>
                  <div>Cyrillic: {analysisDetails.cyrillic_count}</div>
                  <div>Zero-width: {analysisDetails.zero_width_count}</div>
                  <div>Thin spaces: {analysisDetails.thin_spaces_count}</div>
                  <div>Total markers: {analysisDetails.total_markers}</div>
                  <div>Text length: {analysisDetails.text_length}</div>
                </div>
              )}

              <button
                className={styles.backBtn}
                onClick={() => setShowResults(false)}
              >
                ← Back to Input
              </button>
            </div>

            <div className={styles.resultCard}>
              <div className={styles.score}>{aiPercentage}%</div>
              <p className={styles.scoreLabel}>of text is likely AI</p>

              <div className={styles.barChart}>
                <div className={styles.barGroup}>
                  <div 
                    className={styles.barAI} 
                    style={{ height: `${Math.max(aiPercentage * 2, 20)}px` }}
                  >
                    <span className={styles.barValue}>{aiPercentage}%</span>
                  </div>
                  <span className={styles.barLabel}>AI-Generated</span>
                </div>

                <div className={styles.barGroup}>
                  <div 
                    className={styles.barHuman} 
                    style={{ height: `${Math.max(humanPercentage * 2, 40)}px` }}
                  >
                    <span className={styles.barValue}>{humanPercentage}%</span>
                  </div>
                  <span className={styles.barLabel}>Human Written</span>
                </div>

                <span className={styles.barBaseLine} />
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default EducationalHomepage
