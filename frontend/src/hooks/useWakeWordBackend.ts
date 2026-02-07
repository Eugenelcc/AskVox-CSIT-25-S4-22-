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

  const flushSegment = async () => {
    // Reset segment start on flush to avoid runaway segments
    segStartAtRef.current = null;
    const audioCtx = audioCtxRef.current;
    if (!audioCtx) return;

    const sr = audioCtx.sampleRate | 0;
    const length = pcmChunksRef.current.reduce((n, a) => n + a.length, 0);
    if (length < sr * 0.6) { // skip very short clips (often low-quality for ASR)
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
      if (!enabled) return;
      if (Date.now() < muteUntilRef.current) return;
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

      // During active segment, also buffer into the main PCM accumulator
      if (!hadSpeechRef.current) return;
      pcmChunksRef.current.push(copy);
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
      if (!enabled) return;
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

      if (!hadSpeechRef.current && !isSilent) {
        hadSpeechRef.current = true;
        currentSegRef.current = segCounterRef.current++;
        segStartAtRef.current = Date.now();
        // Prepend pre-roll so we don't clip the first syllable
        pcmChunksRef.current = [...preRollRef.current];
        preRollRef.current = [];
        try { postLog(`[seg ${currentSegRef.current}] start`, 'seg'); } catch { /* ignore */ }
      }

      if (hadSpeechRef.current) {
        if (isSilent) {
          if (!silenceStartRef.current) silenceStartRef.current = Date.now();
          const elapsed = Date.now() - (silenceStartRef.current || 0);
          if (elapsed >= silenceDurationMs) {
            void flushSegment();
            hadSpeechRef.current = false;
            silenceStartRef.current = null;
            currentSegRef.current = null;
          }
        } else {
          silenceStartRef.current = null;
        }
      }

      // Force flush if segment runs too long without silence
      if (hadSpeechRef.current && segStartAtRef.current) {
        const elapsed = Date.now() - segStartAtRef.current;
        if (elapsed >= maxSegmentMs) {
          try { postLog(`[seg ${currentSegRef.current}] force-flush after ${elapsed}ms`, 'seg'); } catch { /* ignore */ }
          void flushSegment();
          hadSpeechRef.current = false;
          silenceStartRef.current = null;
          currentSegRef.current = null;
          segStartAtRef.current = null;
        }
      }

      setTimeout(tick, chunkDurationMs);
    };

    tick();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!enabled) return;
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
      try { processorRef.current?.disconnect(); } catch { /* ignore */ }
      processorRef.current = null;
      try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
      streamRef.current = null;
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
      statusRef.current = 'idle';
      setStatus('idle');
    };
    // setupAudio/monitorSilence intentionally omitted: they use refs and should not re-trigger due to identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { status };
}
