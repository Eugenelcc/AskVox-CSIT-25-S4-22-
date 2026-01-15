import { type FC, type FormEvent, type KeyboardEvent, useState, useRef, useEffect,} from "react";
import { Paperclip, Mic, BookOpen, Send } from "lucide-react";
import "./ChatBar.css";

interface ChatBarProps {
  onSubmit?: (text: string) => void;
  onAttachClick?: () => void;
  
  onMicClick?: () => void;
  onQuizClick?: () => void;
  disabled?: boolean;
  wakeWord?: string;
}

const MAX_TEXTAREA_HEIGHT = 160;

const ChatBar: FC<ChatBarProps> = ({
  onSubmit,
  onAttachClick,
  onMicClick,
  onQuizClick,
  disabled,
  wakeWord,
}) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // recording and STT 
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  // guard to avoid submitting the same text twice in quick succession
  const lastSubmittedRef = useRef<{ text: string; ts: number } | null>(null);

  const sendMessage = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    // prevent duplicate submissions of the same text within 3s
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
    // Enter is send and then Shift+Enter is a new line
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

  //  start/stop recording 
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        //stop all track
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });

        
        //send to the backend stt endpoint
        try {
          setIsTranscribing(true);
          const formData = new FormData();
          formData.append("file", audioBlob, "recording.webm");

          //const res = await fetch("http://localhost:8000/gstt/transcribe", {   //Google STT endpoint
          const res = await fetch("http://localhost:8000/stt/", {   //Assembly STT endpoint
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            console.error("STT request failed");
            return;
          }

          const data = await res.json();
          const transcript = data.text ?? "";

          if (transcript) {
            console.log("🎤 [ChatBar STT] transcript:", transcript);
          }

          if (transcript) {
            // Instead of auto-sending, place the transcript into the input
            const current = textareaRef.current?.value ?? "";
            const finalText = current ? `${current.trim()} ${transcript}` : transcript;
            setValue(finalText);
            // Focus textarea so user can review/edit then press Send
            try { textareaRef.current?.focus(); } catch {}
          }
        } catch (err) {
          console.error("Error calling STT endpoint", err);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone", err);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };

  const handleMicClickInternal = () => {
    if (disabled) return;

    
    onMicClick?.();

    if (!isRecording) {
      void startRecording();
    } else {
      stopRecording();
    }
  };

  const isMicActive = isRecording || isTranscribing;

  return (
    <div className="av-chatbar-wrapper">
      <form className="av-chatbar" onSubmit={handleSubmit}>
        <button
          type="button"
          className="av-icon-button"
          onClick={onAttachClick}
          disabled={disabled}
          aria-label="Attach"
        >
          <Paperclip className="av-icon" />
        </button>

        <textarea
          ref={textareaRef}
          className="av-input"
          placeholder={`Enter text here or say "${wakeWord ?? 'Hey AskVox'}"...`}
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
            aria-label={isMicActive ? "Stop voice input" : "Voice input"}
          >
            <Mic className="av-icon" />
          </button>

          <button
            type="button"
            className="av-icon-button"
            onClick={onQuizClick}
            disabled={disabled}
            aria-label="Quiz"
          >
            <BookOpen className="av-icon" />
          </button>

          <button
            type="submit"
            className="av-send-button"
            disabled={disabled || !value.trim()}
            aria-label="Send"
          >
            <Send className="av-icon" />
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatBar;
