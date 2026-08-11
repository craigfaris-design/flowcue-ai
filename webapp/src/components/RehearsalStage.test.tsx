import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { RehearsalStage } from "./RehearsalStage";
import { tokenizeScript, type SyncState } from "../engine/syncEngine";

const scriptText = "Good evening everyone. When Sarah first told me she was getting married. We have been friends.";
const { sentences, tokens } = tokenizeScript(scriptText);

function state(overrides: Partial<SyncState> = {}): SyncState {
  return {
    cursorTokenIndex: 0,
    sentenceIndex: 0,
    frozen: false,
    totalTokens: tokens.length,
    totalSentences: sentences.length,
    confidence: 0,
    ...overrides,
  };
}

function sentenceEl(container: HTMLElement, idx: number) {
  return container.querySelector(`[data-sentence-idx="${idx}"]`) as HTMLElement;
}

describe("RehearsalStage -- Focus zone mode", () => {
  it("keeps the active sentence at full opacity, dims neighbors, and nearly hides everything further away", () => {
    const { container } = render(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state({ sentenceIndex: 1 })}
        visualMode="focus"
        listening={false}
      />
    );

    expect(sentenceEl(container, 1).className).toContain("sentence--focusNear");
    expect(sentenceEl(container, 0).className).toContain("sentence--focusMid");
    expect(sentenceEl(container, 2).className).toContain("sentence--focusMid");
  });

  it("treats sentences two or more away as equally far, however far that is", () => {
    // Reuses a longer script so there's a sentence at distance >= 2 in
    // both directions from the active one.
    const longer = tokenizeScript(
      "One sentence here. Two sentence here. Three sentence here. Four sentence here. Five sentence here."
    );
    const { container } = render(
      <RehearsalStage
        sentences={longer.sentences}
        tokens={longer.tokens}
        state={state({ sentenceIndex: 2, totalSentences: longer.sentences.length, totalTokens: longer.tokens.length })}
        visualMode="focus"
        listening={false}
      />
    );

    expect(sentenceEl(container, 0).className).toContain("sentence--focusFar");
    expect(sentenceEl(container, 4).className).toContain("sentence--focusFar");
  });
});

describe("RehearsalStage -- Confidence colors mode", () => {
  it("colors the active sentence green when confidently tracking", () => {
    const { container } = render(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state({ sentenceIndex: 0, confidence: 0.9, frozen: false })}
        visualMode="confidence"
        listening
      />
    );
    expect(sentenceEl(container, 0).className).toContain("sentence--confidence-high");
  });

  it("colors the active sentence amber at moderate confidence", () => {
    const { container } = render(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state({ sentenceIndex: 0, confidence: 0.6, frozen: false })}
        visualMode="confidence"
        listening
      />
    );
    expect(sentenceEl(container, 0).className).toContain("sentence--confidence-medium");
  });

  it("colors the active sentence red when frozen, regardless of the last confidence value", () => {
    const { container } = render(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state({ sentenceIndex: 0, confidence: 0.9, frozen: true })}
        visualMode="confidence"
        listening
      />
    );
    expect(sentenceEl(container, 0).className).toContain("sentence--confidence-low");
  });

  it("does not color by confidence before listening has started (nothing to reflect yet)", () => {
    const { container } = render(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state({ sentenceIndex: 0, confidence: 0.9 })}
        visualMode="confidence"
        listening={false}
      />
    );
    expect(sentenceEl(container, 0).className).not.toContain("sentence--confidence-");
  });
});

describe("RehearsalStage -- word accessibility", () => {
  it("opens the pronunciation popover via keyboard (Enter and Space), not just a mouse click", () => {
    // Found via accessibility review: word spans had onClick but no
    // keyboard handler, tabIndex, or role -- making "Tap any word for
    // pronunciation help" (an onboarding-advertised feature) entirely
    // unreachable without a mouse.
    const { container, rerender } = render(
      <RehearsalStage sentences={sentences} tokens={tokens} state={state()} visualMode="sentence" listening={false} />
    );
    const firstWord = container.querySelector(".word") as HTMLElement;
    expect(firstWord.getAttribute("role")).toBe("button");
    expect(firstWord.getAttribute("tabIndex")).toBe("0");

    fireEvent.keyDown(firstWord, { key: "Enter" });
    expect(container.querySelector(".pronouncePopover")).toBeTruthy();

    rerender(
      <RehearsalStage sentences={sentences} tokens={tokens} state={state()} visualMode="sentence" listening={false} />
    );
    fireEvent.keyDown(container.querySelector(".word") as HTMLElement, { key: " " });
    expect(container.querySelector(".pronouncePopover")).toBeTruthy();
  });

  it("does not open the popover for an unrelated key", () => {
    const { container } = render(
      <RehearsalStage sentences={sentences} tokens={tokens} state={state()} visualMode="sentence" listening={false} />
    );
    fireEvent.keyDown(container.querySelector(".word") as HTMLElement, { key: "Tab" });
    expect(container.querySelector(".pronouncePopover")).toBeFalsy();
  });
});

describe("RehearsalStage -- non-color confidence indicator", () => {
  it("renders a distinct icon per confidence level, not just a color, for colorblind accessibility", () => {
    const { container, rerender } = render(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state({ confidence: 0.9 })}
        visualMode="confidence"
        listening
      />
    );
    expect(container.querySelector(".sentence__confidenceBadge--high")).toBeTruthy();

    rerender(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state({ confidence: 0.6 })}
        visualMode="confidence"
        listening
      />
    );
    expect(container.querySelector(".sentence__confidenceBadge--medium")).toBeTruthy();

    rerender(
      <RehearsalStage sentences={sentences} tokens={tokens} state={state({ frozen: true })} visualMode="confidence" listening />
    );
    expect(container.querySelector(".sentence__confidenceBadge--low")).toBeTruthy();
  });
});

describe("RehearsalStage -- punctuation-only sentence chunks", () => {
  it("does not render a garbled clickable paragraph for a sentence chunk with no real word tokens", () => {
    // Found via accessibility review: a script fragment like "...   ,,,"
    // tokenizes to a non-empty sentence chunk with zero real tokens in
    // it, which previously still rendered as a bare-punctuation paragraph.
    const punctuationOnly = tokenizeScript("Good evening everyone. ,,,");
    const { container } = render(
      <RehearsalStage
        sentences={punctuationOnly.sentences}
        tokens={punctuationOnly.tokens}
        state={state({ totalTokens: punctuationOnly.tokens.length, totalSentences: punctuationOnly.sentences.length })}
        visualMode="sentence"
        listening={false}
      />
    );
    expect(container.querySelectorAll("p.sentence")).toHaveLength(1);
    expect(container.textContent).not.toContain(",,,");
  });
});

describe("RehearsalStage -- Mirror flip", () => {
  it("applies the mirrored class only when mirrorFlip is on", () => {
    const { container, rerender } = render(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state()}
        visualMode="sentence"
        listening={false}
      />
    );
    expect(container.querySelector(".rehearsalStage")?.className).not.toContain("rehearsalStage--mirrored");

    rerender(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state()}
        visualMode="sentence"
        listening={false}
        mirrorFlip
      />
    );
    expect(container.querySelector(".rehearsalStage")?.className).toContain("rehearsalStage--mirrored");
  });
});

describe("RehearsalStage -- Connecting/Ready", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a Connecting banner while listening but not yet ready, with the elapsed seconds", () => {
    const { container } = render(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state()}
        visualMode="sentence"
        listening
        ready={false}
        connectingSeconds={3}
      />
    );
    const banner = container.querySelector(".rehearsalStage__connecting");
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain("Connecting");
    expect(banner?.textContent).toContain("3s");
    expect(container.querySelector(".rehearsalStage__readyFlash")).toBeFalsy();
  });

  it("never shows Connecting when not listening at all (nothing to connect to yet)", () => {
    const { container } = render(
      <RehearsalStage sentences={sentences} tokens={tokens} state={state()} visualMode="sentence" listening={false} ready={false} />
    );
    expect(container.querySelector(".rehearsalStage__connecting")).toBeFalsy();
  });

  it("suppresses the 'holding position' freeze banner until actually ready -- connecting isn't the same as frozen", () => {
    const { container } = render(
      <RehearsalStage
        sentences={sentences}
        tokens={tokens}
        state={state({ frozen: true })}
        visualMode="sentence"
        listening
        ready={false}
      />
    );
    expect(container.querySelector(".rehearsalStage__freeze")).toBeFalsy();
    expect(container.querySelector(".rehearsalStage__connecting")).toBeTruthy();
  });

  it("flashes an unmistakable Ready confirmation the instant ready flips true, then dismisses itself", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <RehearsalStage sentences={sentences} tokens={tokens} state={state()} visualMode="sentence" listening ready={false} />
    );
    expect(container.querySelector(".rehearsalStage__readyFlash")).toBeFalsy();

    act(() => {
      rerender(
        <RehearsalStage sentences={sentences} tokens={tokens} state={state()} visualMode="sentence" listening ready />
      );
    });
    expect(container.querySelector(".rehearsalStage__connecting")).toBeFalsy();
    expect(container.querySelector(".rehearsalStage__readyFlash")).toBeTruthy();
    expect(container.querySelector(".rehearsalStage__readyFlash")?.textContent).toContain("Ready");

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(container.querySelector(".rehearsalStage__readyFlash")).toBeFalsy();
  });

  it("does not flash Ready again on every re-render while already ready -- only on the false-to-true transition", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <RehearsalStage sentences={sentences} tokens={tokens} state={state()} visualMode="sentence" listening ready />
    );
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(container.querySelector(".rehearsalStage__readyFlash")).toBeFalsy();

    act(() => {
      rerender(
        <RehearsalStage sentences={sentences} tokens={tokens} state={state({ sentenceIndex: 1 })} visualMode="sentence" listening ready />
      );
    });
    expect(container.querySelector(".rehearsalStage__readyFlash")).toBeFalsy();
  });
});

describe("RehearsalStage -- syllable breaks setting", () => {
  const syllableScript = tokenizeScript("We value clear communication and good timing.");

  it("inserts middle-dots into long/complicated words when the setting is on", () => {
    const { container } = render(
      <RehearsalStage
        sentences={syllableScript.sentences}
        tokens={syllableScript.tokens}
        state={state({ totalTokens: syllableScript.tokens.length, totalSentences: syllableScript.sentences.length })}
        visualMode="sentence"
        listening={false}
        syllabifyLongWords
      />
    );
    expect(container.textContent).toContain("com·mu·ni·ca·tion");
  });

  it("leaves words as plain text when the setting is off (the default)", () => {
    const { container } = render(
      <RehearsalStage
        sentences={syllableScript.sentences}
        tokens={syllableScript.tokens}
        state={state({ totalTokens: syllableScript.tokens.length, totalSentences: syllableScript.sentences.length })}
        visualMode="sentence"
        listening={false}
      />
    );
    expect(container.textContent).toContain("communication");
    expect(container.textContent).not.toContain("·");
  });

  it("does not change the word passed to the pronunciation popover or its aria-label", () => {
    const { container, getByLabelText } = render(
      <RehearsalStage
        sentences={syllableScript.sentences}
        tokens={syllableScript.tokens}
        state={state({ totalTokens: syllableScript.tokens.length, totalSentences: syllableScript.sentences.length })}
        visualMode="sentence"
        listening={false}
        syllabifyLongWords
      />
    );
    // The accessible name stays the plain word (screen readers shouldn't
    // hear "com dot mu dot ni..."), even though the visible text is split.
    const wordButton = getByLabelText("communication: show pronunciation help");
    fireEvent.click(wordButton);
    expect(container.querySelector(".pronouncePopover__word")?.textContent).toBe("communication");
  });

  it("leaves short/simple words unsplit even when the setting is on", () => {
    const { container } = render(
      <RehearsalStage
        sentences={syllableScript.sentences}
        tokens={syllableScript.tokens}
        state={state({ totalTokens: syllableScript.tokens.length, totalSentences: syllableScript.sentences.length })}
        visualMode="sentence"
        listening={false}
        syllabifyLongWords
      />
    );
    expect(container.textContent).toContain(" good ");
    expect(container.textContent).toContain(" and ");
  });
});
