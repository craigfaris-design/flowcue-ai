import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ScriptWorkspace } from "./ScriptWorkspace";
import { addSession, getSessionsForScript } from "../lib/storage";
import type { Script } from "../lib/types";

const script: Script = {
  id: "s1",
  title: "Toast",
  body: "Good evening everyone.",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cachedOffline: false,
};

class MockRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

let lastInstance: MockRecognition | null = null;

beforeEach(() => {
  localStorage.clear();
  lastInstance = null;
  window.SpeechRecognition = vi.fn(function (this: MockRecognition) {
    lastInstance = new MockRecognition();
    return lastInstance;
  }) as unknown as new () => MockRecognition;
});

afterEach(() => {
  delete window.SpeechRecognition;
});

function noop() {}

describe("ScriptWorkspace offline mode", () => {
  it("keeps live cueing available when offline mode is off", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    expect(screen.getByText("▶ Start Listening").closest("button")).not.toBeDisabled();
    expect(screen.queryByText(/Live cueing is off while Offline Mode is on/)).not.toBeInTheDocument();
  });

  it("replaces live cueing with Offline Reading (paced, no mic/network) when offline mode is on", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={true}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    expect(screen.queryByText("▶ Start Listening")).not.toBeInTheDocument();
    expect(screen.getByText("Offline Reading")).toBeInTheDocument();
    expect(screen.getByText(/▶/)).toBeInTheDocument();
    expect(screen.getByText(/No mic or internet connection is used here/)).toBeInTheDocument();
    // Forced on by the Settings toggle -- no way back to live cueing from
    // here without turning the setting off.
    expect(screen.queryByText("Switch back to live cueing")).not.toBeInTheDocument();
  });

  it("disclosure text describes AssemblyAI by default, not 'never sent anywhere'", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    expect(screen.getByText(/Audio streams to AssemblyAI for low-latency transcription/)).toBeInTheDocument();
    expect(screen.queryByText(/not stored or sent anywhere by default/)).not.toBeInTheDocument();
  });

  it("falls back to the browser recognizer (and says so) when AssemblyAI isn't usable", () => {
    // jsdom has no getUserMedia/AudioWorklet, so AssemblyAI is never
    // "supported" here -- exercises the exact fallback path a real browser
    // would take if the relay/API key isn't reachable.
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    fireEvent.click(screen.getByText("▶ Start Listening"));

    expect(screen.getByText(/\(browser fallback\)/)).toBeInTheDocument();
    expect(screen.getByText(/browser's built-in speech recognition/)).toBeInTheDocument();
  });

  it("shows what the recognizer actually heard, distinguishing 'mic not picking up speech' from 'words not matching'", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    fireEvent.click(screen.getByText("▶ Start Listening"));
    expect(screen.getByText(/nothing yet -- check mic input/)).toBeInTheDocument();

    act(() => {
      lastInstance!.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "good evening everyone" } }] });
    });

    expect(screen.getByText("good evening everyone")).toBeInTheDocument();
    expect(screen.queryByText(/nothing yet/)).not.toBeInTheDocument();
  });

  it("does not claim to be personalized with no rehearsal history yet", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );
    expect(screen.queryByText(/Personalized to how live cueing/)).not.toBeInTheDocument();
  });

  it("shows the personalization disclosure once there's enough local rehearsal history", () => {
    // Seed 5 well-tracked past sessions (the adaptiveTuning.ts minimum) --
    // this is deliberately using the real storage module, not a mock, so
    // this test exercises the actual wiring from localStorage through
    // computeAdaptiveOptions into the rendered component, not just the
    // pure function in isolation (already covered by adaptiveTuning.test.ts).
    for (let i = 0; i < 5; i++) {
      addSession({
        scriptId: script.id,
        date: new Date(2026, 0, i + 1).toISOString(),
        durationSec: 60,
        wordCount: 100,
        fillerCount: 0,
        wpm: 140,
        fillerRate: 0,
        confidence: 90,
        freezeCount: 0,
      });
    }

    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );
    expect(screen.getByText(/Personalized to how live cueing has tracked you/)).toBeInTheDocument();
    expect(screen.getByText(/your last 5 sessions/)).toBeInTheDocument();
  });

  it("records how many times tracking froze during a session, visible in the coach report", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    fireEvent.click(screen.getByText("▶ Start Listening"));
    act(() => {
      lastInstance!.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "good evening everyone" } }] });
    });
    fireEvent.click(screen.getByText("■ Stop"));

    expect(screen.getByText("Tracking holds")).toBeInTheDocument();
    // A clean run with no ad-libbed/mismatched speech never freezes.
    expect(screen.getByText("Tracking holds").nextSibling?.textContent).toBe("0");
  });
});

describe("ScriptWorkspace offline reading", () => {
  const multiSentenceScript: Script = {
    ...script,
    id: "s2",
    body: "Good evening everyone. Thank you for being here tonight. It means a lot to us.",
  };

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("offers a manual opt-in even when offline mode is off and the connection is fine", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    expect(screen.getByText("▶ Start Listening")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Read offline instead \(no mic or internet needed\)/));

    expect(screen.getByText("Offline Reading")).toBeInTheDocument();
    expect(screen.queryByText("▶ Start Listening")).not.toBeInTheDocument();
    // Not forced by Settings this time -- can switch back.
    fireEvent.click(screen.getByText("Switch back to live cueing"));
    expect(screen.getByText("▶ Start Listening")).toBeInTheDocument();
  });

  it("proactively suggests Offline Reading when no internet connection is detected", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    expect(screen.getByText(/No internet connection detected/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Read offline instead", { selector: "button" }));
    expect(screen.getByText("Offline Reading")).toBeInTheDocument();
  });

  it("advances the cursor over time at the set pace once started, with no mic/network involved", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ScriptWorkspace
        script={multiSentenceScript}
        defaultVisualMode="sentence"
        offlineModeEnabled={true}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    fireEvent.click(screen.getByText(/▶ Start Reading/));
    expect(screen.getByText(/Reading \(paced, offline\)/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    // Some sentence beyond the first should now be marked active/done --
    // i.e. the highlight actually moved forward on its own.
    const firstSentence = container.querySelector('[data-sentence-idx="0"]');
    expect(firstSentence?.className).toMatch(/sentence--done|sentence--active/);
  });

  it("pauses in place and resumes from the same spot, not from the start", () => {
    vi.useFakeTimers();
    render(
      <ScriptWorkspace
        script={multiSentenceScript}
        defaultVisualMode="sentence"
        offlineModeEnabled={true}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    fireEvent.click(screen.getByText(/▶ Start Reading/));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.click(screen.getByText("⏸ Pause"));
    expect(screen.getByText("Stopped")).toBeInTheDocument();

    // Resuming should say "Resume", not restart the "Start Reading" label.
    expect(screen.getByText(/▶ Resume/)).toBeInTheDocument();
  });

  it("tapping a line jumps the paced cursor there directly", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ScriptWorkspace
        script={multiSentenceScript}
        defaultVisualMode="sentence"
        offlineModeEnabled={true}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    fireEvent.click(screen.getByText(/▶ Start Reading/));
    act(() => {
      vi.advanceTimersByTime(8000); // drift toward the end of the script
    });

    // Tap back to the first sentence to resync.
    const firstSentence = container.querySelector('[data-sentence-idx="0"]') as HTMLElement;
    fireEvent.click(firstSentence);
    expect(firstSentence.className).toMatch(/sentence--active/);
  });

  it("adjusts pace with the +/- controls", () => {
    render(
      <ScriptWorkspace
        script={multiSentenceScript}
        defaultVisualMode="sentence"
        offlineModeEnabled={true}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    expect(screen.getByText("140 wpm")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Faster"));
    expect(screen.getByText("150 wpm")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Slower"));
    fireEvent.click(screen.getByLabelText("Slower"));
    expect(screen.getByText("130 wpm")).toBeInTheDocument();
  });

  it("never shows a mic-based 'nothing heard yet' or listening status while reading offline", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={true}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    expect(screen.queryByText(/nothing yet -- check mic input/)).not.toBeInTheDocument();
    expect(screen.queryByText("● Listening")).not.toBeInTheDocument();
  });
});

describe("ScriptWorkspace practice mode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderWorkspace() {
    return render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        syllabifyLongWords={false}
        speechLanguage="en-US"
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );
  }

  it("is off by default and toggleable before starting", () => {
    renderWorkspace();
    const checkbox = screen.getByLabelText(/Practice Mode/) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("locks the toggle once listening starts, so a session can't straddle both modes", () => {
    renderWorkspace();
    const checkbox = screen.getByLabelText(/Practice Mode/) as HTMLInputElement;
    fireEvent.click(screen.getByText("▶ Start Listening"));
    expect(checkbox).toBeDisabled();
  });

  it("shows a practice summary instead of AI Coach, and never saves to session history", () => {
    renderWorkspace();
    fireEvent.click(screen.getByLabelText(/Practice Mode/));
    fireEvent.click(screen.getByText("▶ Start Listening"));
    act(() => {
      lastInstance!.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "good evening everyone" } }],
      });
    });
    fireEvent.click(screen.getByText("■ Stop"));

    expect(screen.getByText("Practice Summary")).toBeInTheDocument();
    expect(screen.queryByText("AI Coach")).not.toBeInTheDocument();
    expect(screen.getByText(/wasn't saved to your session history/)).toBeInTheDocument();
    expect(getSessionsForScript(script.id)).toEqual([]);
  });

  it("shows the real AI Coach report and saves normally when practice mode is off", () => {
    renderWorkspace();
    fireEvent.click(screen.getByText("▶ Start Listening"));
    act(() => {
      lastInstance!.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "good evening everyone" } }],
      });
    });
    fireEvent.click(screen.getByText("■ Stop"));

    expect(screen.getByText("AI Coach")).toBeInTheDocument();
    expect(screen.queryByText("Practice Summary")).not.toBeInTheDocument();
    expect(getSessionsForScript(script.id).length).toBe(1);
  });

  it("surfaces a live coaching nudge while listening in practice mode", () => {
    vi.useFakeTimers();
    renderWorkspace();
    fireEvent.click(screen.getByLabelText(/Practice Mode/));
    fireEvent.click(screen.getByText("▶ Start Listening"));

    act(() => {
      lastInstance!.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "one two three four five six seven eight" } }],
      });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // 8 words spoken in an instant reads as an extremely high live wpm once
    // the tick recomputes it -- deterministically lands on the "too fast"
    // nudge without needing to control real wall-clock timing in a test.
    expect(screen.getByText(/slowing down/i)).toBeInTheDocument();
  });

  it("does not show a live nudge when practice mode is off", () => {
    vi.useFakeTimers();
    renderWorkspace();
    fireEvent.click(screen.getByText("▶ Start Listening"));

    act(() => {
      lastInstance!.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "one two three four five six seven eight" } }],
      });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByText(/slowing down/i)).not.toBeInTheDocument();
  });
});
