import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

type UseWakeProps = {
  onWake?: (score: number) => void;
  onCommand?: (text: string) => void;
  enabled?: boolean;
  chunkDurationMs?: number;   // default 250
  silenceDurationMs?: number; // default 900
  silenceThreshold?: number;  // default 0.02 (RMS)
  maxSegmentMs?: number;      // default 5000 (force flush if no silence)
};

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

export function useWakeWordBackend({
  onWake,
  onCommand,
  enabled = true,
  chunkDurationMs = 250,
  silenceDurationMs = 900,
  // Slightly more sensitive default for real-world mics (avoids never-starting segments on quiet inputs).
  silenceThreshold = 0.0025,
  maxSegmentMs = 5000,
}: UseWakeProps) {
  const [status, setStatus] = useState<'idle' | 'listening' | 'awaiting_command'>('idle');
  const statusRef = useRef<'idle' | 'listening' | 'awaiting_command'>('idle');
  // Mirror `enabled` in a ref so audio callbacks see live value,
  // not the initial prop snapshot.
  const enabledRef = useRef<boolean>(enabled);
  // Once a wake is detected and we hand control to conversational mode,
  // fully suspend wake listening until the hook is torn down or
  // re-enabled. This prevents extra segments / voice_logs during
  // conversation.
  const wakeSuspendedRef = useRef<boolean>(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const segCounterRef = useRef(1);
  const currentSegRef = useRef<number | null>(null);
  const segStartAtRef = useRef<number | null>(null);
  const muteUntilRef = useRef<number>(0);
  const preRollRef = useRef<Float32Array[]>([]);
  const PRE_ROLL_MS = 400;

  const lastRmsLogAtRef = useRef<number>(0);
  const resumeAttemptAtRef = useRef<number>(0);
  const debugRms = (() => {
    try {
      return globalThis.localStorage?.getItem('askvox.wakeDebug') === '1';
    } catch {
      return false;
    }
  })();

  const hadSpeechRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const trailingSilenceMsRef = useRef<number>(0);
  const audioFramesSeenRef = useRef<number>(0);
  const noiseFloorRmsRef = useRef<number>(0);
  const effectiveThresholdRef = useRef<number>(silenceThreshold);
  const lastCalibLogAtRef = useRef<number>(0);

  const postLog = (text: string, kind: string) => {
    try {
      fetch(`${import.meta.env.VITE_API_URL}/voice/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, kind }),
      }).catch(() => { /* ignore */ });
    } catch {
      /* ignore */
    }
  };

  // Keep enabledRef in sync with the latest prop.
  useEffect(() => {
    enabledRef.current = !!enabled;
  }, [enabled]);

  const stopCapture = () => {
    try { processorRef.current?.disconnect(); } catch { /* ignore */ }
    processorRef.current = null;
    try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
    analyserRef.current = null;
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    streamRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;

    pcmChunksRef.current = [];
    preRollRef.current = [];
    hadSpeechRef.current = false;
    silenceStartRef.current = null;
    trailingSilenceMsRef.current = 0;
    currentSegRef.current = null;
    segStartAtRef.current = null;
  };

  const flushSegment = async () => {
    // Reset segment start on flush to avoid runaway segments
    segStartAtRef.current = null;
    const audioCtx = audioCtxRef.current;
    if (!audioCtx) return;

    const sr = audioCtx.sampleRate | 0;
    const length = pcmChunksRef.current.reduce((n, a) => n + a.length, 0);
    // Wake phrases can be short; allow down to ~450ms.
    if (length < sr * 0.45) {
      const segPreview = currentSegRef.current ?? segCounterRef.current;
      const durMs = Math.round((length / Math.max(1, sr)) * 1000);
      try { postLog(`[seg ${segPreview}] drop dur=${durMs}ms (too short)`, 'upload'); } catch { /* ignore */ }
      pcmChunksRef.current = [];
      return;
    }
    const merged = new Float32Array(length);
    let off = 0;
    for (const c of pcmChunksRef.current) { merged.set(c, off); off += c.length; }
    pcmChunksRef.current = [];

    const seg = currentSegRef.current ?? segCounterRef.current++;
    const durMs = Math.round((length / Math.max(1, sr)) * 1000);
    try { postLog(`[seg ${seg}] send sr=${sr} samples=${length} dur=${durMs}ms bytes=${merged.byteLength}`, 'upload'); } catch { /* ignore */ }

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes?.session?.access_token;
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch(`${import.meta.env.VITE_API_URL}/wake/transcribe_pcm?sr=${sr}`, {
        method: 'POST',
        headers,
        body: merged.buffer,
      });
      if (!resp.ok) {
        try { postLog(`[seg ${seg}] http ${resp.status}`, 'error'); } catch { /* ignore */ }
        return;
      }
      const data = await resp.json().catch(() => ({} as any));
      const text: string = data.text ?? '';
      const command: string = data.command ?? '';
      const wake: boolean = !!data.wake_match;
      const score: number = data.score ?? 0;
      const reason: string = data.reason ?? '';

      if (text) postLog(text, 'final');
      try {
        postLog(
          `[seg ${seg}] result wake=${wake} score=${score}${reason ? ` reason=${reason}` : ''}`,
          'result'
        );
      } catch { /* ignore */ }

      if (wake) {
        postLog(`wake (score=${score})`, 'wake');
        // Suspend wake listening and tear down the audio graph so that
        // conversational mode can take over the mic without any
        // additional wake segments or voice_logs.
        wakeSuspendedRef.current = true;
        stopCapture();
        onWake?.(score);
        // Mute capture briefly to avoid recording TTS "Yes?"
        muteUntilRef.current = Date.now() + 800;
        statusRef.current = 'awaiting_command';
        setStatus('awaiting_command');
        if (normalize(command).length > 0) {
          postLog(command, 'command');
          onCommand?.(command);
          statusRef.current = 'listening';
          setStatus('listening');
        }
      } else if (statusRef.current === 'awaiting_command' && normalize(command).length > 0) {
        postLog(command, 'command');
        onCommand?.(command);
        statusRef.current = 'listening';
        setStatus('listening');
      }
    } catch (e) {
      try { postLog(`[seg ${seg}] error ${String(e)}`, 'error'); } catch { /* ignore */ }
    }
  };

  const setupAudio = async () => {
    if (streamRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Prefer reliability across devices for wake capture.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000,
      } as MediaTrackConstraints,
      video: false,
    });
    streamRef.current = stream;

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    if (audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume();
        postLog('audio context resumed', 'wake');
      } catch {
        // Some browsers require a user gesture; monitorSilence will retry.
        postLog('audio context is suspended (needs user gesture)', 'wake_error');
      }
    }
    const source = audioCtx.createMediaStreamSource(stream);

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 1.0;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    const processor = audioCtx.createScriptProcessor(2048, 1, 1);

    source.connect(gainNode);
    gainNode.connect(analyser);
    gainNode.connect(processor);
    processor.connect(audioCtx.destination);

    processor.onaudioprocess = (e) => {
      if (!enabledRef.current || wakeSuspendedRef.current) return;
      const now = Date.now();
      if (now < muteUntilRef.current) return;
      const ch0 = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(ch0.length);
      copy.set(ch0);

      // Always maintain a small pre-roll buffer to capture onsets
      preRollRef.current.push(copy);
      const sr = audioCtxRef.current?.sampleRate || 16000;
      const maxPreRollSamples = Math.floor(sr * (PRE_ROLL_MS / 1000));
      let total = preRollRef.current.reduce((n, a) => n + a.length, 0);
      while (total > maxPreRollSamples) {
        const removed = preRollRef.current.shift();
        total -= removed?.length || 0;
      }

      // RMS-based VAD using the actual mic samples.
      let sum = 0;
      for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i];
      const rms = Math.sqrt(sum / Math.max(1, copy.length));
      // Calibrate an approximate noise floor when we're not in a segment.
      // This avoids "never starts" issues on quiet mics / aggressive processing.
      if (!hadSpeechRef.current) {
        const prev = noiseFloorRmsRef.current || rms;
        noiseFloorRmsRef.current = prev * 0.98 + rms * 0.02;
        const adaptive = noiseFloorRmsRef.current * 3.0 + 0.0005;
        effectiveThresholdRef.current = Math.max(silenceThreshold, adaptive);
        if (debugRms && now - lastCalibLogAtRef.current > 5000) {
          lastCalibLogAtRef.current = now;
          try {
            postLog(
              `[calib] noise=${noiseFloorRmsRef.current.toFixed(4)} thr=${effectiveThresholdRef.current.toFixed(4)} rms=${rms.toFixed(4)}`,
              'rms'
            );
          } catch { /* ignore */ }
        }
      }

      const isSilent = rms < effectiveThresholdRef.current;
      const frameMs = (copy.length / Math.max(1, sr)) * 1000;

      // One-time proof that the audio callback is running.
      if (audioFramesSeenRef.current === 0) {
        try { postLog('mic frames flowing (onaudioprocess active)', 'wake'); } catch { /* ignore */ }
      }
      audioFramesSeenRef.current += 1;

      // Start segment on first detected speech.
      if (!hadSpeechRef.current && !isSilent) {
        hadSpeechRef.current = true;
        silenceStartRef.current = null;
        trailingSilenceMsRef.current = 0;
        // Reset noise floor once we enter speech.
        noiseFloorRmsRef.current = 0;
        currentSegRef.current = segCounterRef.current++;
        segStartAtRef.current = now;
        pcmChunksRef.current = [...preRollRef.current, copy];
        preRollRef.current = [];
        try { postLog(`[seg ${currentSegRef.current}] start`, 'seg'); } catch { /* ignore */ }
        return;
      }

      // If we're in a segment, buffer audio and decide when to flush.
      if (hadSpeechRef.current) {
        pcmChunksRef.current.push(copy);

        if (isSilent) {
          trailingSilenceMsRef.current += frameMs;
          if (trailingSilenceMsRef.current >= silenceDurationMs) {
            void flushSegment();
            hadSpeechRef.current = false;
            silenceStartRef.current = null;
            trailingSilenceMsRef.current = 0;
            currentSegRef.current = null;
            segStartAtRef.current = null;
            return;
          }
        } else {
          trailingSilenceMsRef.current = 0;
        }

        if (segStartAtRef.current && now - segStartAtRef.current >= maxSegmentMs) {
          try { postLog(`[seg ${currentSegRef.current}] force-flush after ${now - segStartAtRef.current}ms`, 'seg'); } catch { /* ignore */ }
          void flushSegment();
          hadSpeechRef.current = false;
          silenceStartRef.current = null;
          trailingSilenceMsRef.current = 0;
          currentSegRef.current = null;
          segStartAtRef.current = null;
          return;
        }
      }
    };

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    processorRef.current = processor;
  };

  const monitorSilence = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);

    const tick = () => {
      if (!enabledRef.current || wakeSuspendedRef.current) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const isSilent = rms < silenceThreshold;

      // Periodic telemetry: confirms the loop is alive and mic RMS changes in production.
      const now = Date.now();
      if (debugRms && now - lastRmsLogAtRef.current > 5000) {
        lastRmsLogAtRef.current = now;
        try { postLog(`[rms] ${rms.toFixed(4)} silent=${isSilent} hadSpeech=${hadSpeechRef.current}`, 'rms'); } catch { /* ignore */ }
      }

      // If AudioContext is suspended, retry resume occasionally.
      const ctx = audioCtxRef.current;
      if (ctx?.state === 'suspended' && now - resumeAttemptAtRef.current > 3000) {
        resumeAttemptAtRef.current = now;
        void ctx.resume().then(
          () => postLog('audio context resumed (retry)', 'wake'),
          () => postLog('audio context still suspended', 'wake_error')
        );
      }

      // Segmenting/VAD is handled in the ScriptProcessor callback.

      setTimeout(tick, chunkDurationMs);
    };

    tick();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!enabled) {
        // When disabled (mic off or in conversational mode),
        // tear down capture but keep wakeSuspendedRef as-is so
        // the hook stays fully off until re-enabled.
        stopCapture();
        statusRef.current = 'idle';
        setStatus('idle');
        return;
      }
      wakeSuspendedRef.current = false;
      // One-time proof that the hook is alive in production.
      try { postLog('wake listening enabled', 'wake'); } catch { /* ignore */ }
      statusRef.current = 'listening';
      setStatus('listening');
      try {
        await setupAudio();
        if (cancelled) return;
        monitorSilence();
      } catch (e) {
        // Common causes: mic permission denied, insecure context, Safari gesture requirements.
        try { postLog(`wake setup failed: ${String(e)}`, 'wake_error'); } catch { /* ignore */ }
        statusRef.current = 'idle';
        setStatus('idle');
      }
    })();
    return () => {
      cancelled = true;
      stopCapture();
      statusRef.current = 'idle';
      setStatus('idle');
    };
    // setupAudio/monitorSilence intentionally omitted: they use refs and should not re-trigger due to identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { status };
}
