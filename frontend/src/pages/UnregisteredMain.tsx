import { useEffect, useRef, useState } from "react";
// ✅ 1. Import Session Type
import type { Session } from "@supabase/supabase-js";

import Background from "../components/background/background";
import ChatBar from "../components/chat/ChatBar";
import BlackHole from "../components/background/Blackhole";
import UnregisteredTopBar from "../components/TopBars/unregisteredtopbar";
import ChatMessages from "../components/chat/UnregisteredChatMessages";
import { useWakeWordBackend } from "../hooks/useWakeWordBackend.ts";
import { supabase } from "../supabaseClient";

import type { ChatMessage } from "../types/database"; 
import "./cssfiles/UnregisteredMain.css";

const USER_ID = 874902 as const;
const LLAMA_ID = 212020 as const;

// ✅ 2. Update Component to accept 'session' prop
const UnregisteredMain = ({ session }: { session: Session | null }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [guestSessionId, setGuestSessionId] = useState<string | null>(null);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioPlayRef = useRef<HTMLAudioElement | null>(null);
  const voiceAudioCtxRef = useRef<AudioContext | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const hadSpeechRef = useRef(false);
  const voiceModeRef = useRef(false);
  const ttsActiveRef = useRef(false);
  const ttsSanitizeRef = useRef<((t: string) => string) | null>(null);
  const voiceGuestSessionIdRef = useRef<string | null>(null);

  const postLog = (text: string, kind: string) => {
    try {
      fetch('http://localhost:8000/voice/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, kind }),
      }).catch(() => {});
    } catch {}
  };

  // Load existing guest session id if present
  useEffect(() => {
    const existing = sessionStorage.getItem('guest_session_id');
    if (existing) setGuestSessionId(existing);
  }, []);

  // Ensure a guest chat_session exists (DB-backed only)
  const ensureGuestSession = async (titleHint: string): Promise<string> => {
    if (guestSessionId) return guestSessionId;

    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({
        user_id: null,
        title: (titleHint || 'Guest Chat').slice(0, 30) + '...',
      })
      .select()
      .single();

    if (error || !data?.id) {
      console.error('chat_sessions insert failed:', error);
      throw new Error('Guest session not created');
    }

    sessionStorage.setItem('guest_session_id', data.id);
    setGuestSessionId(data.id);
    return data.id;
  };



  const handleSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // 1. Create user object
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      senderId: USER_ID,
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsSending(true);

    // Ensure guest session id for linking rows
    let currentSessionId: string;
    try {
      currentSessionId = await ensureGuestSession(trimmed);
    } catch (e) {
      console.error(e);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        senderId: LLAMA_ID,
        content: "Sorry, we couldn't start a guest session.",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setIsSending(false);
      return;
    }

    /* 👉 INSERT THE GUARD HERE 👈 */
    if (!currentSessionId) {
      console.error("No valid session_id, aborting inserts");
      setIsSending(false);
      return;
}

    // Insert into queries (capture query_id to link response)
    const queryId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    try {
      await supabase.from('queries').insert({
        id: queryId,
        session_id: currentSessionId,
        user_id: null,
        input_mode: 'text',
        transcribed_text: trimmed,
        detected_domain: 'general'
      });
    } catch {}

    // Mirror RegisteredMain: persist user chat message
    try {
      await supabase.from('chat_messages').insert({
        session_id: currentSessionId,
        user_id: null,
        role: 'user',
        content: trimmed,
        display_name: 'Guest'
      });
    } 
    catch {}

    // 2. Prepare history payload
    const historyPayload = [...messages, userMsg].map(m => ({
      role: m.senderId === USER_ID ? "user" : "assistant",
      content: m.content,
    }));


    // 3. Call the backend
    try {
      const streamId = `llama-${Date.now()}`;
      const resp = await fetch("http://localhost:8000/llamachats/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: historyPayload,
          query_id: queryId,
          session_id: currentSessionId,
        }),
      });

      if (!resp.ok) {
        console.error("Chat API error", resp.status);
        const errorMsg: ChatMessage = {
          id: `err-${Date.now()}`,
          senderId: LLAMA_ID,
          content: "Sorry, something went wrong when connecting with AskVox.",
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        return;
      }

      const data = await resp.json();
      const replyText: string = data.answer ?? data.reply ?? "";

      // 4. Reveal Response (Typewriter Effect)
      setIsSending(false);

      const assistantMsg: ChatMessage = {
        id: streamId,
        senderId: LLAMA_ID,
        content: "",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // --- NEW LOGIC START ---
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const step = 4;

      for (let i = 0; i <= replyText.length; i += step) {
        const partial = replyText.slice(0, i);
        setMessages((prev) =>
          prev.map((m) => (m.id === streamId ? { ...m, content: partial } : m))
        );
        await sleep(15);
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === streamId ? { ...m, content: replyText } : m))
      );
      // --- NEW LOGIC END ---

      // Mirror RegisteredMain: persist assistant chat message (optional)
      try {
        await supabase.from('chat_messages').insert({
          session_id: currentSessionId,
          user_id: null,
          role: 'assistant',
          content: replyText || '(No response received.)',
          display_name: 'AskVox'
        });
      } catch {}

      if (!replyText) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamId ? { ...m, content: "(No response received.)" } : m
          )
        );
      }
    } catch (err) {
      console.error("Network/LLM error", err);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        senderId: LLAMA_ID,
        content: "Sorry, I could not reach AskVox server.",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsSending(false);
    }
  };

  // --- Voice Mode (wake -> voice-only flow for guests) ---
  const cleanTextForTTS = (text: string) => {
    try {
      let t = text ?? "";
      t = t.replace(/```[\s\S]*?```/g, " ");
      t = t.replace(/`([^`]+)`/g, "$1");
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
      t = t.replace(/[\*#_~>]+/g, "");
      t = t.replace(/\[[^\]]*\]/g, "");
      t = t.replace(/^\s*[-•\d+\.)]+\s+/gm, "");
      t = t.replace(/[\s\u00A0]+/g, " ").trim();
      t = t.replace(/([,.!?])\1+/g, "$1");
      t = t.replace(/[\u2000-\u206F]/g, "");
      return t;
    } catch {
      return text ?? "";
    }
  };
  ttsSanitizeRef.current = cleanTextForTTS;

  // Keep a ref in sync with isVoiceMode to avoid stale-closure bugs
  useEffect(() => {
    voiceModeRef.current = isVoiceMode;
  }, [isVoiceMode]);

  const speakWithGoogleTTS = async (text: string, rearmAfterPlayback: boolean = true) => {
    try {
      const safeText = (ttsSanitizeRef.current?.(text)) ?? text;
      postLog(`TTS request: ${safeText}`, 'tts');
      // Mark TTS active BEFORE stopping recorder to avoid re-arm race in onstop
      ttsActiveRef.current = true;
      const res = await fetch("http://localhost:8000/tts/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: safeText, language_code: "en-US" }),
      });
      if (!res.ok) { console.error("TTS request failed"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioPlayRef.current) { try { audioPlayRef.current.pause(); } catch {} }
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
          try { setIsRecording(false); } catch {}
        }
      } catch {}
      const audio = new Audio(url);
      audio.preload = "auto";
      audioPlayRef.current = audio;
      try {
        await audio.play();
        postLog('TTS playback started', 'tts');
      } catch (e) {
        try { URL.revokeObjectURL(url); } catch {}
        ttsActiveRef.current = false;
        if (voiceModeRef.current && rearmAfterPlayback) {
          setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 150);
        }
        return;
      }
      const restart = () => {
        try { URL.revokeObjectURL(url); } catch {}
        ttsActiveRef.current = false;
        if (voiceModeRef.current && rearmAfterPlayback) {
          setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 200);
        }
      };
      const fail = () => {
        try { URL.revokeObjectURL(url); } catch {}
        ttsActiveRef.current = false;
        if (voiceModeRef.current && rearmAfterPlayback) {
          setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 300);
        }
      };
      audio.addEventListener("ended", restart, { once: true });
      audio.addEventListener("error", fail, { once: true });
      const timerId = window.setTimeout(() => fail(), 30000);
      audio.addEventListener("ended", () => window.clearTimeout(timerId), { once: true });
      audio.addEventListener("error", () => window.clearTimeout(timerId), { once: true });
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        audio.addEventListener("ended", done, { once: true });
        audio.addEventListener("error", done, { once: true });
      });
    } catch (e) {
      ttsActiveRef.current = false;
      if (voiceModeRef.current) { setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 200); }
    }
  };

  const startVoiceRecording = async () => {
    if (isRecording || !voiceModeRef.current || ttsActiveRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
        } as MediaTrackConstraints,
      });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        try { setIsRecording(false); } catch {}
        mediaRecorderRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        try {
          voiceAnalyserRef.current?.disconnect();
          voiceSourceRef.current?.disconnect();
          await voiceAudioCtxRef.current?.close();
        } catch {}
        voiceAnalyserRef.current = null;
        voiceSourceRef.current = null;
        voiceAudioCtxRef.current = null;
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        try {
          setIsTranscribing(true);
          const formData = new FormData();
          formData.append("file", audioBlob, "utterance.webm");
          const sttRes = await fetch("http://localhost:8000/stt/", { method: "POST", body: formData });
          if (!sttRes.ok) { return; }
          const sttData = await sttRes.json();
          const transcript: string = sttData.text ?? "";
          if (transcript) postLog(transcript, 'stt');
          if (transcript) {
            const tnorm = transcript.toLowerCase();
            if (
              tnorm.includes("stop listening") ||
              tnorm.includes("goodbye") ||
              tnorm.includes("bye") ||
              tnorm.includes("end")
            ) {
              exitVoiceMode();
              return;
            }
            // Ensure a guest session exists for voice mode (one per run)
            let currentSessionId = voiceGuestSessionIdRef.current ?? guestSessionId;
            if (!currentSessionId) {
              try {
                currentSessionId = await ensureGuestSession(transcript);
                voiceGuestSessionIdRef.current = currentSessionId;
                setGuestSessionId(currentSessionId);
              } catch {}
            }

            const userMsgId = globalThis.crypto?.randomUUID?.() ?? `vuser-${Date.now()}-${Math.random()}`;
            setMessages(prev => [...prev, { id: userMsgId, senderId: USER_ID, content: transcript, createdAt: new Date().toISOString() }]);

            // Persist user voice message (optional but keeps parity with registered)
            if (currentSessionId) {
              try {
                await supabase.from('chat_messages').insert({
                  session_id: currentSessionId,
                  user_id: null,
                  role: 'user',
                  content: transcript,
                  display_name: 'Guest',
                });
              } catch {}
            }

            // Insert a queries row for analytics/linking
            const queryId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
            if (currentSessionId) {
              try {
                await supabase.from('queries').insert({
                  id: queryId,
                  session_id: currentSessionId,
                  user_id: null,
                  input_mode: 'voice',
                  transcribed_text: transcript,
                  detected_domain: 'general',
                });
              } catch {}
            }
            const sealionRes = await fetch("http://localhost:8000/sealionchats/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                message: transcript,
                history: messages.map(m => ({ role: m.senderId === USER_ID ? "user" : "assistant", content: m.content })),
                query_id: typeof queryId !== 'undefined' ? queryId : null,
                session_id: currentSessionId ?? null,
              }),
            });
            const sealionData = await sealionRes.json();
            const replyText = sealionData.answer || sealionData.response || sealionData.reply || "";
            if (replyText) {
              const botMsgId = globalThis.crypto?.randomUUID?.() ?? `vbot-${Date.now()}-${Math.random()}`;
              setMessages(prev => [...prev, { id: botMsgId, senderId: LLAMA_ID, content: replyText, createdAt: new Date().toISOString() }]);
              void speakWithGoogleTTS(replyText);
            } else {
              if (voiceModeRef.current) { setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 250); }
            }
          }
        } catch (err) {
          if (voiceModeRef.current) { setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 400); }
        } finally {
          setIsTranscribing(false);
          if (voiceModeRef.current && !ttsActiveRef.current) {
            setTimeout(() => {
              if (voiceModeRef.current && (!audioPlayRef.current || audioPlayRef.current.paused)) {
                void startVoiceRecording();
              }
            }, 300);
          }
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      const audioCtx = new AudioContext();
      try { await audioCtx.resume(); } catch {}
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      voiceAudioCtxRef.current = audioCtx;
      voiceAnalyserRef.current = analyser;
      voiceSourceRef.current = source;
      const buf = new Float32Array(analyser.fftSize);
      const silenceThreshold = 0.008;
      const silenceHoldMs = 1200;
      const hardCapMs = 10000;
      let lastVoiceAt = Date.now();
      hadSpeechRef.current = false;
      const tick = () => {
        if (!voiceAnalyserRef.current || !mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms >= silenceThreshold) { lastVoiceAt = now; hadSpeechRef.current = true; }
        if (hadSpeechRef.current && now - lastVoiceAt >= silenceHoldMs) {
          try { mediaRecorderRef.current?.stop(); } catch {}
          mediaRecorderRef.current = null;
          setIsRecording(false);
          return;
        }
        if (now - (audioCtx as any).startTimeMs >= hardCapMs) {
          try { mediaRecorderRef.current?.stop(); } catch {}
          mediaRecorderRef.current = null;
          setIsRecording(false);
          return;
        }
        requestAnimationFrame(tick);
      };
      (audioCtx as any).startTimeMs = Date.now();
      requestAnimationFrame(tick);
    } catch {
      setIsRecording(false);
    }
  };

  const enterVoiceMode = () => {
    setIsVoiceMode(true);
    voiceModeRef.current = true;
    voiceGuestSessionIdRef.current = null;
    // In voice mode, hide chat input, show BlackHole, start with TTS confirmation
    void speakWithGoogleTTS("AskVox is listening", true);
  };

  const exitVoiceMode = () => {
    voiceModeRef.current = false;
    setIsVoiceMode(false);
    voiceGuestSessionIdRef.current = null;
    try { (window as any).speechSynthesis?.cancel?.(); } catch {}
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch {}
    mediaRecorderRef.current = null;
    setIsRecording(false);
    try { audioPlayRef.current?.pause(); } catch {}
    audioPlayRef.current = null;
    try {
      voiceAnalyserRef.current?.disconnect();
      voiceSourceRef.current?.disconnect();
      voiceAudioCtxRef.current?.close();
    } catch {}
    voiceAnalyserRef.current = null;
    voiceSourceRef.current = null;
    voiceAudioCtxRef.current = null;
  };

  // Wake detection: when wake triggers, enter voice mode; disable during voice mode
  useWakeWordBackend({
    enabled: !isVoiceMode,
    onWake: enterVoiceMode,
  });

  const hasMessages = messages.length > 0;

  return (
    <div className="uv-root">
      <Background />
      
      {/* ✅ 3. Pass the session to the TopBar */}
      <UnregisteredTopBar session={session} />

      <main className="uv-main">
        {(!hasMessages || isVoiceMode) && (
          <section className="uv-hero">
            <BlackHole />
            {isVoiceMode && (
              <h4 className="orb-caption" style={{ fontSize: 22, opacity: 0.75, marginTop: 16 }}>
                {isRecording || isTranscribing ? "Listening…" : ""}
              </h4>
            )}
          </section>
        )}

        {!isVoiceMode && hasMessages && (
          <div className="uv-chat-scroll-outer">
            <div className="uv-chat-area">
              <ChatMessages messages={messages} isLoading={isSending} />
            </div>
          </div>
        )}
      </main>

      {!isVoiceMode && (<ChatBar onSubmit={handleSubmit} disabled={isSending} />)}
    </div>
  );
};

export default UnregisteredMain;