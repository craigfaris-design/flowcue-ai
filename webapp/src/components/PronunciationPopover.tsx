import { useEffect, useRef } from "react";
import { analyze } from "../engine/pronounce";
import "./PronunciationPopover.css";

interface PronunciationPopoverProps {
  word: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function PronunciationPopover({ word, x, y, onClose }: PronunciationPopoverProps) {
  const info = analyze(word);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      // Found via accessibility review: this had no keyboard dismissal at
      // all (only closed via a mousedown-outside listener), and no focus
      // management -- a keyboard/screen-reader user opening it (now
      // possible per the word-span fix in RehearsalStage.tsx) had no way
      // to close it without a mouse, and no indication it had opened.
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    // Restore focus to whatever opened this (the word span) on close, so
    // keyboard users land back where they were instead of losing their
    // place in the document.
    return () => trigger?.focus?.();
  }, []);

  function playSlow() {
    if (!("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(info.word);
    utter.rate = 0.55;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  const left = Math.max(0, Math.min(x, window.innerWidth - 260));
  const top = Math.max(0, Math.min(y + 12, window.innerHeight - 160));

  return (
    <div
      ref={ref}
      className="pronouncePopover"
      style={{ left, top }}
      role="dialog"
      aria-label={`Pronunciation help for ${info.word}`}
      tabIndex={-1}
    >
      <div className="pronouncePopover__word">{info.word}</div>
      <div className="pronouncePopover__row">
        <span>Syllables</span>
        <span className="pronouncePopover__val">{info.syllableBreakdown}</span>
      </div>
      <div className="pronouncePopover__row">
        <span>Simplified</span>
        <span className="pronouncePopover__val">{info.simplifiedRespelling}</span>
      </div>
      <button className="btn btn--secondary pronouncePopover__play" onClick={playSlow}>
        ▶ Slow audio
      </button>
    </div>
  );
}
