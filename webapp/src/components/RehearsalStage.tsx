import { useEffect, useRef, useState } from "react";
import type { ScriptToken, SyncState } from "../engine/syncEngine";
import type { VisualMode } from "../lib/types";
import { syllabifyForDisplay } from "../engine/pronounce";
import { PronunciationPopover } from "./PronunciationPopover";
import "./RehearsalStage.css";

interface RehearsalStageProps {
  sentences: string[];
  tokens: ScriptToken[];
  state: SyncState;
  visualMode: VisualMode;
  listening: boolean;
  /** For real teleprompter hardware (beam-splitter glass) -- the display
   * must show mirrored text so it reads correctly once reflected. */
  mirrorFlip?: boolean;
  /** Inserts a middle-dot between syllables of long/complicated words --
   * display only, so this only ever changes {w} below, never the `w` value
   * passed to the pronunciation popover or the aria-label (both read more
   * naturally, and analyze() expects the plain word, without the dots). */
  syllabifyLongWords?: boolean;
  /** Offline Reading mode's resync gesture: tap any line to jump the paced
   * cursor there. Undefined during normal (speech-driven) live cueing,
   * where a tap should only open the pronunciation popover, not also yank
   * the sync engine's own cursor around. */
  onSentenceTap?: (sentenceIndex: number) => void;
}

function confidenceLevel(state: SyncState): "high" | "medium" | "low" {
  if (state.frozen) return "low";
  if (state.confidence >= 0.8) return "high";
  if (state.confidence >= 0.5) return "medium";
  return "low";
}

export function RehearsalStage({
  sentences,
  tokens,
  state,
  visualMode,
  listening,
  mirrorFlip = false,
  syllabifyLongWords = false,
  onSentenceTap,
}: RehearsalStageProps) {
  const [popover, setPopover] = useState<{ word: string; x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastScrolledSentence = useRef(-1);

  useEffect(() => {
    if (state.sentenceIndex !== lastScrolledSentence.current) {
      lastScrolledSentence.current = state.sentenceIndex;
      const el = stageRef.current?.querySelector(`[data-sentence-idx="${state.sentenceIndex}"]`);
      if (el && typeof el.scrollIntoView === "function") {
        // "auto" (instant jump), not "smooth" -- a animated scroll takes a
        // browser-controlled few hundred ms to complete, which is exactly
        // the kind of visible lag the live-cueing engine promises to avoid.
        el.scrollIntoView({ behavior: "auto", block: "center" });
      }
    }
  }, [state.sentenceIndex]);

  return (
    <div className={"rehearsalStage" + (mirrorFlip ? " rehearsalStage--mirrored" : "")} ref={stageRef}>
      {state.frozen && listening && (
        <div className="rehearsalStage__freeze" role="status">
          {state.cursorTokenIndex === -1
            ? // No word has matched yet at all -- this is the normal state
              // while a presenter chats with the room, tells a story, or
              // otherwise hasn't started reading the script yet. "Holding
              // position" implies something went wrong and it's trying to
              // recover; nothing has gone wrong here, it just hasn't begun.
              "Waiting for you to begin — start reading anytime."
            : "Holding position — waiting to confidently re-detect where you are."}
        </div>
      )}
      <div className="rehearsalStage__text">
        {sentences.map((sentenceText, sIdx) => {
          // A sentence chunk that's pure punctuation/whitespace (e.g. the
          // script contained a stray "..." or ",,,") has no real tokens in
          // it at all -- tokenizeScript already excludes those from
          // `tokens`, but the sentence chunk itself still exists, so
          // without this check it would render as a garbled, clickable
          // "sentence" of bare punctuation alongside a confusing "This
          // script is empty" message shown for the *overall* empty case.
          // Found via review; skip it, nothing to show or highlight here.
          const words = sentenceText.split(/\s+/).filter(Boolean);
          if (!tokens.some((t) => t.sentenceIndex === sIdx)) return null;

          const isActive = sIdx === state.sentenceIndex;
          let cls =
            "sentence" +
            (sIdx < state.sentenceIndex ? " sentence--done" : "") +
            (isActive ? " sentence--active" : "") +
            (onSentenceTap ? " sentence--tappable" : "");

          if (visualMode === "focus") {
            // A constrained teleprompter "reading window": only the
            // active line and its immediate neighbors stay legible,
            // everything further away fades almost out of view, cutting
            // down on eye movement the way physical teleprompter hardware
            // does with a narrow glass.
            const distance = Math.abs(sIdx - state.sentenceIndex);
            cls += distance === 0 ? " sentence--focusNear" : distance === 1 ? " sentence--focusMid" : " sentence--focusFar";
          }

          const showConfidence = visualMode === "confidence" && isActive && listening;
          if (showConfidence) {
            // Colors the active line by how well the engine is actually
            // tracking right now (from the sync engine's own match ratio),
            // not just a binary frozen/not -- green while it's confidently
            // placed, amber/red as that confidence drops, giving the
            // presenter direct feedback instead of a surprise freeze.
            cls += ` sentence--confidence-${confidenceLevel(state)}`;
          }

          return (
            <p
              key={sIdx}
              className={cls}
              data-sentence-idx={sIdx}
              aria-label={showConfidence ? `Tracking confidence: ${confidenceLevel(state)}` : undefined}
              // Tapping anywhere in a line -- including a word, whose own
              // onClick below still fires first for the pronunciation
              // popover -- resyncs Offline Reading's paced cursor to here.
              // That's the actual desired behavior, not a conflict: tapping
              // a word you're looking at *is* pointing at "I'm here."
              onClick={onSentenceTap ? () => onSentenceTap(sIdx) : undefined}
            >
              {showConfidence && (
                // Color alone isn't a reliable signal for colorblind users,
                // and by the time the "Holding position" banner appears the
                // color has already been red for a few seconds (see
                // syncEngine's freezeAfterMs) -- this icon gives the same
                // information a non-color way, visible the instant
                // confidence changes.
                <span className={`sentence__confidenceBadge sentence__confidenceBadge--${confidenceLevel(state)}`} aria-hidden="true">
                  {confidenceLevel(state) === "high" ? "●" : confidenceLevel(state) === "medium" ? "▲" : "■"}
                </span>
              )}
              {words.map((w, wi) => {
                const openPopoverAt = (x: number, y: number) => setPopover({ word: w, x, y });
                const displayText = syllabifyLongWords ? syllabifyForDisplay(w) : w;
                return (
                  <span
                    key={wi}
                    className="word"
                    role="button"
                    tabIndex={0}
                    aria-label={`${w}: show pronunciation help`}
                    onClick={(e) => openPopoverAt(e.clientX, e.clientY)}
                    onKeyDown={(e) => {
                      // Found via accessibility review: this was mouse/touch-only,
                      // making one of the app's onboarding-advertised features
                      // ("Tap any word for pronunciation help") entirely
                      // unreachable by keyboard or screen-reader users.
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      openPopoverAt(rect.left, rect.bottom);
                    }}
                  >
                    {displayText}{" "}
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
