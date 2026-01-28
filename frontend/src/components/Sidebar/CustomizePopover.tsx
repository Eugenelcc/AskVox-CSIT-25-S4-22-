// src/components/Sidebar/CustomizePopover.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  title: string;

  // optional legacy prop (we ignore left/top because we control via drag state)
  style?: React.CSSProperties;

  defaultColor?: string;
  defaultEmoji?: string;

  onClose: () => void;
  onSave: (payload: { color?: string; emoji?: string }) => void;

  // ✅ live preview while clicking
  onChange?: (payload: { color?: string; emoji?: string }) => void;
};

const COLORS = [
  "#6E2525", "#4A264B", "#262E4C", "#274C2D", "#27454D", "#734209", "#B1640B",
  "#D24545", "#9A2C9E", "#B4B03E", "#3E3E81", "#267F35", "#227186", "#754B1C",
  "#FC0202", "#F804FF", "#FFEB00", "#0000F9", "#00FC29", "#00C9FF", "#FF8E0D",
];

const EMOJIS = [
  "🌋","🌟","🧪","⚛️","😔","⚽️","🍜","🌍","🏛️","🎨","🎵","📚",
  "🧠","🛰️","🗺️","🌊","🏔️","🌦️","🔥","✨","🍕","🍰","🧩","📝",
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function CustomizePopover({
  title,
  style,
  defaultColor,
  defaultEmoji,
  onClose,
  onSave,
  onChange,
}: Props) {
  const [color, setColor] = useState<string | undefined>(defaultColor);
  const [emoji, setEmoji] = useState<string | undefined>(defaultEmoji);

  const popRef = useRef<HTMLDivElement | null>(null);

  // ✅ start “higher”
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const ww = window.innerWidth;
    return { x: Math.round(ww / 2 - 245 / 2), y: 110 };
  });

  const dragRef = useRef({
    dragging: false,
    offsetX: 0,
    offsetY: 0,
  });

  useEffect(() => setColor(defaultColor), [defaultColor]);
  useEffect(() => setEmoji(defaultEmoji), [defaultEmoji]);

  // ✅ live preview (updates sidebar background immediately)
  useEffect(() => {
    onChange?.({ color, emoji });
  }, [color, emoji, onChange]);

  const canSave = useMemo(() => {
    return (color ?? "") !== (defaultColor ?? "") || (emoji ?? "") !== (defaultEmoji ?? "");
  }, [color, emoji, defaultColor, defaultEmoji]);

  // ✅ clamp into viewport on mount + on resize
  useEffect(() => {
    const margin = 12;

    const place = () => {
      const el = popRef.current;
      const ww = window.innerWidth;
      const wh = window.innerHeight;

      const rect = el?.getBoundingClientRect();
      const pw = rect?.width ?? 245;
      const ph = rect?.height ?? 340;

      const x = clamp(pos.x, margin, ww - pw - margin);
      // keep it from starting too low
      const y = clamp(pos.y, 60, wh - ph - margin);

      setPos({ x, y });
    };

    // wait a tick so height/width are known
    setTimeout(place, 0);

    const onResize = () => place();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ dragging (mousemove / mouseup on window)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;

      const el = popRef.current;
      const margin = 12;
      const ww = window.innerWidth;
      const wh = window.innerHeight;

      const rect = el?.getBoundingClientRect();
      const pw = rect?.width ?? 245;
      const ph = rect?.height ?? 340;

      const nextX = clamp(e.clientX - dragRef.current.offsetX, margin, ww - pw - margin);
      const nextY = clamp(e.clientY - dragRef.current.offsetY, margin, wh - ph - margin);

      setPos({ x: nextX, y: nextY });
    };

    const onUp = () => {
      dragRef.current.dragging = false;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      ref={popRef}
      className="av-customize"
      style={{
        left: pos.x,
        top: pos.y,
        // keep any extra style props, but DO NOT allow left/top to override drag
        ...(style ? { ...style, left: undefined, top: undefined } : undefined),
      }}
      onMouseDown={(e) => {
        // prevent sidebar outside click from closing it
        e.stopPropagation();
      }}
    >
      {/* ✅ drag handle */}
      <div
        className="av-customize__header av-customize__header--drag"
        title="Drag"
        onMouseDown={(e) => {
          e.preventDefault();   // ✅ important
          e.stopPropagation();  // ✅ important
          if (e.button !== 0) return;

          const rect = popRef.current?.getBoundingClientRect();
          dragRef.current.dragging = true;
          dragRef.current.offsetX = rect ? e.clientX - rect.left : 0;
          dragRef.current.offsetY = rect ? e.clientY - rect.top : 0;
        }}
      >
        <div className="av-customize__title">{title}</div>
        <button
          type="button"
          className="av-customize__close"
          onMouseDown={(e) => e.stopPropagation()} // don’t start drag
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="av-customize__section">
        <div className="av-customize__label">Choose Colour:</div>
        <div className="av-customize__colors">
          {COLORS.map((c) => {
            const selected = c === color;
            return (
              <button
                key={c}
                type="button"
                className={`av-customize__dot ${selected ? "is-selected" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                title={c}
                aria-label={`Pick color ${c}`}
              />
            );
          })}

          <button
            type="button"
            className={`av-customize__dot av-customize__dot--none ${!color ? "is-selected" : ""}`}
            onClick={() => setColor(undefined)}
            title="No color"
            aria-label="Remove color"
          >
            ⦸
          </button>
        </div>
      </div>

      <div className="av-customize__divider" />

      <div className="av-customize__section">
        <div className="av-customize__label">Choose Emoji:</div>
        <div className="av-customize__emojis">
          {EMOJIS.map((e) => {
            const selected = e === emoji;
            return (
              <button
                key={e}
                type="button"
                className={`av-customize__emoji ${selected ? "is-selected" : ""}`}
                onClick={() => setEmoji(e)}
                aria-label={`Pick emoji ${e}`}
                title={e}
              >
                {e}
              </button>
            );
          })}

          <button
            type="button"
            className={`av-customize__emoji av-customize__emoji--none ${!emoji ? "is-selected" : ""}`}
            onClick={() => setEmoji(undefined)}
            title="No emoji"
            aria-label="Remove emoji"
          >
            ⦸
          </button>
        </div>
      </div>

      <div className="av-customize__footer">
        <button
          type="button"
          className="av-customize__save"
          onClick={() => onSave({ color, emoji })}
          disabled={!canSave}
          title={canSave ? "Save" : "No changes"}
        >
          Save
        </button>
      </div>
    </div>
  );
}
