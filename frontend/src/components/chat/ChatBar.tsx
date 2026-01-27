import {
  type FC,
  type FormEvent,
  type KeyboardEvent,
  useState,
  useRef,
  useEffect,
} from "react";
import { Paperclip, Mic, BookOpen, Send } from "lucide-react";
import "./ChatBar.css";

interface ChatBarProps {
  onSubmit?: (text: string) => void;

  // ✅ ADD
  onFileUpload?: (file: File | null) => void;
  // ✅ ADD
  uploadedFile?: File | null;

  onMicClick?: () => void;
  onQuizClick?: () => void;
  disabled?: boolean;
}

const MAX_TEXTAREA_HEIGHT = 160;

const ChatBar: FC<ChatBarProps> = ({
  onSubmit,
  onFileUpload,
  uploadedFile, // ✅ ADD
  onMicClick,
  onQuizClick,
  disabled,
}) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // ✅ ADD
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // recording and STT
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const lastSubmittedRef = useRef<{ text: string; ts: number } | null>(null);

  const sendMessage = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    const now = Date.now();
    if (
      lastSubmittedRef.current &&
      lastSubmittedRef.current.text === trimmed &&
      now - lastSubmittedRef.current.ts < 3000
    ) {
      return;
    }

    lastSubmittedRef.current = { text: trimmed, ts: now };
    onSubmit?.(trimmed);
    setValue("");
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const newHeight = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT);
    el.style.height = `${newHeight}px`;
    el.style.overflowY =
      el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  };

  useEffect(() => {
    autoResize();
  }, [value]);

  // Build image preview URL for image uploads
  useEffect(() => {
    if (!uploadedFile) {
      setPreviewUrl(null);
      return;
    }

    const ext = uploadedFile.name.split(".").pop()?.toLowerCase();
    const isImage =
      uploadedFile.type.startsWith("image/") ||
      ext === "png" ||
      ext === "jpg" ||
      ext === "jpeg" ||
      ext === "webp" ||
      ext === "gif" ||
      ext === "heic";

    if (!isImage) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(uploadedFile);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [uploadedFile]);

  // 🎤 Mic logic unchanged
  const handleMicClickInternal = () => {
    if (disabled) return;
    onMicClick?.();
  };

  const isMicActive = isRecording || isTranscribing;

  return (
    <div className="av-chatbar-wrapper">
      <form
        className={`av-chatbar ${uploadedFile ? "has-file" : ""}`}
        onSubmit={handleSubmit}
      >
        {/* ===== FILE PREVIEW (INSIDE CHATBAR, NOT FLOATING) ===== */}
        {uploadedFile && (
          (() => {
            const ext = uploadedFile.name.split(".").pop()?.toLowerCase();
            const isImage =
              uploadedFile.type.startsWith("image/") ||
              ext === "png" ||
              ext === "jpg" ||
              ext === "jpeg" ||
              ext === "webp" ||
              ext === "gif" ||
              ext === "heic";

            if (isImage && previewUrl) {
              return (
                <div className="av-file-chip av-file-chip--image">
                  <div className="av-file-thumb">
                    <img src={previewUrl} alt={uploadedFile.name} />
                    <button
                      type="button"
                      className="av-file-remove av-file-remove--overlay"
                      onClick={() => onFileUpload?.(null)}
                      aria-label="Remove file"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div className="av-file-chip">
                <div
                  className={`av-file-icon av-file-icon--${ext}`}
                >
                  {ext?.toUpperCase()}
                </div>

                <div className="av-file-text">
                  <div className="av-file-name">{uploadedFile.name}</div>
                  <div className="av-file-type">{ext?.toUpperCase()}</div>
                </div>

                <div
                  className="av-file-remove"
                  onClick={() => onFileUpload?.(null)}
                >
                  ✕
                </div>
              </div>
            );
          })()
        )}

        {/* ===== INPUT ROW ===== */}
        <div className="av-input-row">
          <button
            type="button"
            className="av-icon-button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="av-icon" />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.heic,image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileUpload?.(file);
              e.target.value = "";
            }}
          />

          <textarea
            ref={textareaRef}
            className="av-input"
            placeholder='Say "Hey AskVox" to begin or type below.'
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
          />

          <div className="av-toolbar-right">
            <button
              type="button"
              className={`av-icon-button ${
                isMicActive ? "av-mic-pulsing" : ""
              }`}
              onClick={handleMicClickInternal}
              disabled={disabled}
            >
              <Mic className="av-icon" />
            </button>

            <button
              type="button"
              className="av-icon-button"
              onClick={onQuizClick}
              disabled={disabled}
            >
              <BookOpen className="av-icon" />
            </button>

            <button
              type="submit"
              className="av-send-button"
              disabled={disabled || !value.trim()}
            >
              <Send className="av-icon" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default ChatBar;
