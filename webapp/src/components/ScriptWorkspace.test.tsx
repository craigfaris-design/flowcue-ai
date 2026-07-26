import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ScriptWorkspace } from "./ScriptWorkspace";
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
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    expect(screen.getByText("▶ Start Listening").closest("button")).not.toBeDisabled();
    expect(screen.queryByText(/Live cueing is off while Offline Mode is on/)).not.toBeInTheDocument();
  });

  it("disables live cueing and explains why when offline mode is on", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={true}
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    const startBtn = screen.getByText("▶ Start Listening").closest("button");
    expect(startBtn).toBeDisabled();
    expect(screen.getByText(/Live cueing is off while Offline Mode is on/)).toBeInTheDocument();

    // Clicking a disabled button is a no-op, but guard against the handler
    // itself starting recognition if disabled state is ever bypassed.
    fireEvent.click(startBtn!);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });

  it("disclosure text accurately describes cloud-based recognition, not 'never sent anywhere'", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
        onBack={noop}
        onScriptUpdated={noop}
        onScriptDeleted={noop}
      />
    );

    expect(screen.getByText(/audio is sent to the browser vendor's cloud service/)).toBeInTheDocument();
    expect(screen.queryByText(/not stored or sent anywhere by default/)).not.toBeInTheDocument();
  });

  it("shows what the recognizer actually heard, distinguishing 'mic not picking up speech' from 'words not matching'", () => {
    render(
      <ScriptWorkspace
        script={script}
        defaultVisualMode="sentence"
        offlineModeEnabled={false}
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
});
