import { useEffect, useRef, useState } from "react";
import type { ScriptToken, SyncState } from "../engine/syncEngine";
import type { VisualMode } from "../lib/types";
import { PronunciationPopover } from "./PronunciationPopover";
import "./RehearsalStage.css";

interface RehearsalStageProps {
  sentences: string[];
  tokens: ScriptToken[];
  state: SyncState;
  visualMode: VisualMode;
  listening: boolean;
}

export function RehearsalStage({ sentences, tokens, state, visualMode, listening }: RehearsalStageProps) {
  const [popover, setPopover] = useState<{ word: string; x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastScrolledSentence = useRef(-1);

  useEffect(() => {
    if (state.sentenceIndex !== lastScrolledSentence.current) {
      lastScrolledSentence.current = state.sentenceIndex;
      const el = stageRef.current?.querySelector(`[data-sentence-idx="${state.sentenceIndex}"]`);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [state.sentenceIndex]);

  let globalWordIdx = 0;

  return (
    <div className="rehearsalStage" ref={stageRef}>
      {state.frozen && listening && (
        <div className="rehearsalStage__freeze">Holding position — waiting to confidently re-detect where you are.</div>
      )}
      <div className="rehearsalStage__text">
        {sentences.map((sentenceText, sIdx) => {
          const words = sentenceText.split(/\s+/).filter(Boolean);
          const cls =
            "sentence" +
            (sIdx < state.sentenceIndex ? " sentence--done" : "") +
            (sIdx === state.sentenceIndex ? " sentence--active" : "");
          return (
            <p key={sIdx} className={cls} data-sentence-idx={sIdx}>
              {words.map((w, wi) => {
                const idx = globalWordIdx++;
                const isKaraokeActive = visualMode === "word" && idx === state.cursorTokenIndex;
                return (
                  <span
                    key={wi}
                    className={"word" + (isKaraokeActive ? " word--active" : "")}
                    onClick={(e) => setPopover({ word: w, x: e.clientX, y: e.clientY })}
                  >
                    {w}{" "}
                  </span>
                );
              })}
            </p>
          );
        })}
      </div>
      {popover && (
        <PronunciationPopover word={popover.word} x={popover.x} y={popover.y} onClose={() => setPopover(null)} />
      )}
      {tokens.length === 0 && <div className="rehearsalStage__empty">This script is empty.</div>}
    </div>
  );
}
