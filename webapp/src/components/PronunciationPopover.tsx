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
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  function playSlow() {
    if (!("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(info.word);
    utter.rate = 0.55;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  const left = Math.min(x, window.innerWidth - 260);
  const top = Math.min(y + 12, window.innerHeight - 160);

  return (
    <div ref={ref} className="pronouncePopover" style={{ left, top }}>
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
