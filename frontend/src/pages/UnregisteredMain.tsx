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
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

type VoiceCaptionItem = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

// ✅ 2. Update Component to accept 'session' prop
const UnregisteredMain = ({
  session,
  micEnabled,
  setMicEnabled,
}: {
  session: Session | null;
  micEnabled: boolean;
  setMicEnabled: (next: boolean | ((prev: boolean) => boolean)) => void;
}) => {
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [guestSessionId, setGuestSessionId] = useState<string | null>(null);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [voiceCaptionFeed, setVoiceCaptionFeed] = useState<VoiceCaptionItem[]>([]);
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

  const voiceCaptionScrollRef = useRef<HTMLDivElement | null>(null);
  const voiceCaptionStickToBottomRef = useRef(true);

  const onVoiceCaptionScroll = () => {
    const el = voiceCaptionScrollRef.current;
    if (!el) return;
    voiceCaptionStickToBottomRef.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
  };

  useEffect(() => {
    const el = voiceCaptionScrollRef.current;
    if (!el) return;
    if (!voiceCaptionStickToBottomRef.current) return;
    try {
      el.scrollTop = el.scrollHeight;
    } catch {}
  }, [voiceCaptionFeed.length]);

  const classifyDomainBestEffort = async (text: string): Promise<string> => {
    try {
      const resp = await fetch(`${API_BASE_URL}/domain/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) return "general";
      const data = (await resp.json()) as { domain?: string };
      return typeof data.domain === "string" && data.domain.trim() ? data.domain : "general";
    } catch {
      return "general";
    }
  };

  const postLog = (text: string, kind: string) => {
    try {
      fetch(`${API_BASE_URL}/voice/log`, {
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
      const detectedDomain = await classifyDomainBestEffort(trimmed);
      await supabase.from('queries').insert({
        id: queryId,
        session_id: currentSessionId,
        user_id: null,
        input_mode: 'text',
        transcribed_text: trimmed,
        detected_domain: detectedDomain,
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
      const resp = await fetch(`${API_BASE_URL}/llamachats-multi/cloud_plus`, {
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

      // Persist assistant response (best-effort) so the guest session shows full history.
      try {
        const { data: existing } = await supabase
          .from('chat_messages')
          .select('id')
          .eq('session_id', currentSessionId)
          .eq('role', 'assistant')
          .eq('content', replyText)
          .order('created_at', { ascending: false })
          .limit(1);
        if (!existing || existing.length === 0) {
          await supabase.from('chat_messages').insert({
            session_id: currentSessionId,
            user_id: null,
            role: 'assistant',
            content: replyText,
            display_name: 'AskVox',
          });
        }
      } catch (e) {
        console.warn('Failed to persist assistant chat_message (guest)', e);
      }


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
      setIsTtsPlaying(true);
      const res = await fetch(`${API_BASE_URL}/tts/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: safeText, language_code: "en-US" }),
      });
      if (!res.ok) { console.error("TTS request failed"); setIsTtsPlaying(false); ttsActiveRef.current = false; return; }
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
        setIsTtsPlaying(false);
        if (voiceModeRef.current && rearmAfterPlayback) {
          setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 150);
        }
        return;
      }
      const restart = () => {
        try { URL.revokeObjectURL(url); } catch {}
        ttsActiveRef.current = false;
        setIsTtsPlaying(false);
        if (voiceModeRef.current && rearmAfterPlayback) {
          setTimeout(() => { if (voiceModeRef.current) void startVoiceRecording(); }, 200);
        }
      };
      const fail = () => {
        try { URL.revokeObjectURL(url); } catch {}
        ttsActiveRef.current = false;
        setIsTtsPlaying(false);
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
      setIsTtsPlaying(false);
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
          const sttRes = await fetch(`${API_BASE_URL}/gstt/transcribe`, { method: "POST", body: formData });
          if (!sttRes.ok) { return; }
          const sttData = await sttRes.json();
          const transcript: string = sttData.text ?? "";
          if (transcript) postLog(transcript, 'stt');
          if (transcript) {
            const capId = globalThis.crypto?.randomUUID?.() ?? `cap-${Date.now()}-${Math.random()}`;
            // Stage: replace "listening" with the user's transcript
            setVoiceCaptionFeed([{ id: capId, role: "user" as const, text: transcript }]);
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
                const detectedDomainVoice = await classifyDomainBestEffort(transcript);
                await supabase.from('queries').insert({
                  id: queryId,
                  session_id: currentSessionId,
                  user_id: null,
                  input_mode: 'voice',
                  transcribed_text: transcript,
                  detected_domain: detectedDomainVoice,
                });
              } catch {}
            }
            const sealionRes = await fetch(`${API_BASE_URL}/llamachats-multi/cloud_plus`, {
             // /llamachats-multi/cloud_plus
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
              const capId = globalThis.crypto?.randomUUID?.() ?? `cap-${Date.now()}-${Math.random()}`;
              // Stage: replace the user's transcript with the assistant response
              setVoiceCaptionFeed([{ id: capId, role: "assistant" as const, text: "" }]);
              const botMsgId = globalThis.crypto?.randomUUID?.() ?? `vbot-${Date.now()}-${Math.random()}`;
              setMessages(prev => [...prev, { id: botMsgId, senderId: LLAMA_ID, content: "", createdAt: new Date().toISOString() }]);

              // Start TTS immediately and type out the response in parallel.
              void speakWithGoogleTTS(replyText);
              void (async () => {
                const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
                const step = 4;
                for (let i = 0; i <= replyText.length; i += step) {
                  const partial = replyText.slice(0, i);
                  setMessages(prev => prev.map(m => (m.id === botMsgId ? { ...m, content: partial } : m)));
                  setVoiceCaptionFeed([{ id: capId, role: "assistant" as const, text: partial }]);
                  await sleep(12);
                }
                setMessages(prev => prev.map(m => (m.id === botMsgId ? { ...m, content: replyText } : m)));
                setVoiceCaptionFeed([{ id: capId, role: "assistant" as const, text: replyText }]);
              })();
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
    if (!micEnabled) return;
    setIsVoiceMode(true);
    voiceModeRef.current = true;
    voiceGuestSessionIdRef.current = null;
    // Stage: show listening prompt immediately
    const capId = globalThis.crypto?.randomUUID?.() ?? `cap-${Date.now()}-${Math.random()}`;
    setVoiceCaptionFeed([{ id: capId, role: "assistant" as const, text: "AskVox is listening" }]);
    // In voice mode, hide chat input, show BlackHole, start with TTS confirmation
    void speakWithGoogleTTS("AskVox is listening", true);
  };

  const exitVoiceMode = () => {
    voiceModeRef.current = false;
    setIsVoiceMode(false);
    voiceGuestSessionIdRef.current = null;
    setIsTtsPlaying(false);
    setVoiceCaptionFeed([]);
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

  useEffect(() => {
    // Hard-stop any active mic flows when toggled off.
    if (!micEnabled && voiceModeRef.current) {
      exitVoiceMode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micEnabled]);

  // Wake detection: when wake triggers, enter voice mode; disable during voice mode
  useWakeWordBackend({
    enabled: micEnabled && !isVoiceMode,
    onWake: enterVoiceMode,
    chunkDurationMs: 250,
    silenceDurationMs: 900,
    silenceThreshold: 0.0025,
    maxSegmentMs: 5000,
  });

  const hasMessages = messages.length > 0;
  const isBlackHoleActive = isVoiceMode && (isRecording || isTranscribing || isTtsPlaying);

  return (
    <div className="uv-root uv-root--guest">
      <Background />
      
      {/* ✅ 3. Pass the session to the TopBar */}
      <UnregisteredTopBar
        session={session}
        micEnabled={micEnabled}
        onToggleMic={() => setMicEnabled((v) => !v)}
      />

      <main className="uv-main">
        {(!hasMessages || isVoiceMode) && (
          <section className="uv-hero">
            <BlackHole isActivated={isBlackHoleActive} />
            {isVoiceMode && (
              <>
                <div className="av-voice-captions">
                  <div className="av-voice-captions__user">
                    {/* left column kept for layout; captions are rendered in the center feed */}
                  </div>

                  <div className="av-voice-captions__assistant">
                    <div
                      ref={voiceCaptionScrollRef}
                      className="av-voice-captions__scroll"
                      onScroll={onVoiceCaptionScroll}
                    >
                      {(() => {
                        const listening =
                          !voiceCaptionFeed.length &&
                          (isRecording || isTranscribing)
                            ? "Listening…"
                            : "";
                        const items: VoiceCaptionItem[] = voiceCaptionFeed.length
                          ? voiceCaptionFeed
                          : (listening ? [{ id: "listening", role: "assistant" as const, text: listening }] : []);
                        return items.map((c) => {
                          const baseOpacity = c.role === "assistant" ? 0.8 : 0.6;
                          const isListeningLine = c.id === "listening" || c.text === "AskVox is listening" || c.text === "Listening…";
                          const label = c.role === "user" ? "User Voice" : "Assistant response";
                          const cleanedText = isListeningLine
                            ? c.text
                            : ((ttsSanitizeRef.current?.(c.text)) ?? c.text);
                          return (
                            <div
                              key={c.id}
                              className="av-voice-caption-item"
                              style={{ opacity: baseOpacity }}
                            >
                              {isListeningLine ? (
                                <h4
                                  className="orb-caption"
                                  style={{ fontSize: 22, textAlign: "center" }}
                                >
                                  {cleanedText}
                                </h4>
                              ) : (
                                <>
                                  <div className="av-voice-caption-label visual-askvox">{label}</div>
                                  <div
                                    className="orb-caption av-voice-caption-text"
                                    style={{ fontSize: 22, textAlign: "left" }}
                                  >
                                    {cleanedText}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  <div className="av-voice-captions__spacer" />
                </div>
              </>
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

      {!isVoiceMode && (
        <div className="uv-input-container">
          {!hasMessages && (
            <div className="av-chatbar-caption">
              <h3 className="orb-caption">
                Say <span className="visual-askvox">"Hey Ask Vox"</span> to begin or type below.
              </h3>
            </div>
          )}
          <ChatBar onSubmit={handleSubmit} disabled={isSending} micEnabled={micEnabled} />
        </div>
      )}
    </div>
  );
};

export default UnregisteredMain;
