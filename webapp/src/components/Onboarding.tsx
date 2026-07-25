import { useEffect, useRef, useState } from "react";
import "./Onboarding.css";

interface OnboardingProps {
  onDismiss: () => void;
}

const STEPS = [
  {
    title: "FlowCue AI listens, and never loses your place.",
    body: "Paste a script and start speaking. Unlike a fixed-speed teleprompter, FlowCue AI follows your actual voice — through pauses, skips, repeats, and ad-libs.",
  },
  {
    title: "Tap any word for pronunciation help.",
    body: "Difficult names or terms? Tap the word during editing or rehearsal for a syllable breakdown, simplified phonetics, and slow audio playback.",
  },
  {
    title: "Get a coach report after every rehearsal.",
    body: "Pace, filler words, and a confidence score — tracked over time per script, so you can see yourself improve.",
  },
];

export function Onboarding({ onDismiss }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.focus();
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  return (
    <div className="onboarding">
      <div
        className="onboarding__card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        tabIndex={-1}
      >
        <div className="onboarding__dots">
          {STEPS.map((_, i) => (
            <span key={i} className={"onboarding__dot" + (i === step ? " onboarding__dot--active" : "")} />
          ))}
        </div>
        <h2 id="onboarding-title">{STEPS[step].title}</h2>
        <p>{STEPS[step].body}</p>
        <div className="onboarding__actions">
          <button className="btn btn--secondary" onClick={onDismiss}>
            Skip
          </button>
          <button
            className="btn btn--primary"
            onClick={() => (isLast ? onDismiss() : setStep(step + 1))}
          >
            {isLast ? "Get started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
