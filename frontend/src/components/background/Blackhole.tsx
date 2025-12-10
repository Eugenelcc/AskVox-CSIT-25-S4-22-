import React, { useEffect, useRef } from "react";
import "./BlackHole.css";

const STAR_COUNT = 140;

const CosmicVoiceOrb: React.FC = () => {
  const starsRef = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const orbGlowRef = useRef<HTMLDivElement | null>(null);

  const listeningRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);

  
  useEffect(() => {
    if (!starsRef.current) return;

    const container = starsRef.current;
    container.innerHTML = "";

    for (let i = 0; i < STAR_COUNT; i++) {
      const star = document.createElement("div");
      star.className = "star";

      const x = Math.random() * 100;
      const y = Math.random() * 100;

      const scale = 0.4 + Math.random() * 1.3;
      const delay = Math.random() * 6;
      const duration = 4 + Math.random() * 6;

      star.style.left = x + "%";
      star.style.top = y + "%";
      star.style.setProperty("--base-scale", scale.toString());
      star.style.setProperty(
        "--base-opacity",
        (0.4 + Math.random() * 0.6).toString()
      );
      star.style.animationDelay = delay + "s";
      star.style.animationDuration = duration + "s";

      container.appendChild(star);
    }
  }, []);

 
  const animateFromMic = () => {
    if (!listeningRef.current) return;
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    const orb = orbRef.current;
    const orbGlow = orbGlowRef.current;
    const stars = starsRef.current;

    if (!analyser || !dataArray || !orb || !orbGlow || !stars) return;

    analyser.getByteTimeDomainData(dataArray);

    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = (dataArray[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);
    const level = Math.min(rms * 4, 1); 

    const scale = 1 + level * 0.25;
    const glowOpacity = 0.35 + level * 0.8;
    const starScale = 1 + level * 0.4;

    orb.style.transform = `scale(${scale})`;
    orbGlow.style.opacity = glowOpacity.toString();
    stars.style.transform = `scale(${starScale})`;

    rafIdRef.current = requestAnimationFrame(animateFromMic);
  };

  const startListening = async () => {
    if (listeningRef.current || !orbRef.current || !orbGlowRef.current) return;

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      mediaStreamRef.current = mediaStream;
    } catch (err) {
      console.error("Microphone permission error:", err);
      return;
    }

    const AudioContextClass =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const audioCtx: AudioContext = new AudioContextClass();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;

    const source = audioCtx.createMediaStreamSource(
      mediaStreamRef.current as MediaStream
    );
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    dataArrayRef.current = dataArray;

    listeningRef.current = true;
    orbRef.current.classList.remove("idle");

    animateFromMic();
  };

  const stopListening = () => {
    listeningRef.current = false;
    if (orbRef.current) {
      orbRef.current.classList.add("idle");
      orbRef.current.style.transform = "scale(1)";
    }
    if (orbGlowRef.current) {
      orbGlowRef.current.style.opacity = "0.35";
    }
    if (starsRef.current) {
      starsRef.current.style.transform = "scale(1)";
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  };

  
  useEffect(() => {
    return () => {
      stopListening();
    };
    
  }, []);

  const handleClick = () => {
    if (!listeningRef.current) {
      startListening();
    } else {
      stopListening();
    }
  };

  return (
    <section className="orb-section">
      <div className="scene">
        <div className="ambient-glow"></div>

        <div className="orb-wrapper">
          <div className="orb-border"></div>

          <button
            className="voice-core idle"
            ref={orbRef}
            aria-label="Voice Input"
            onClick={handleClick}
          >
            <div className="orb-glow" ref={orbGlowRef}></div>
            <div className="stars" ref={starsRef}></div>
          </button>
        </div>
      </div>


      <p className="orb-caption">
        Say <span className="orb-caption-askvox">"Hey AskVox"</span> to begin or
        type below.
      </p>
    </section>
  );
};

export default CosmicVoiceOrb;
