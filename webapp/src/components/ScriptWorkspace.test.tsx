import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  onresult: (() => void) | null = null;
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

beforeEach(() => {
  localStorage.clear();
  window.SpeechRecognition = vi.fn(function (this: MockRecognition) {
    return new MockRecognition();
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
});
