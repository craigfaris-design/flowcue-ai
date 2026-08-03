import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  localStorage.clear();
});

function dismissOnboarding() {
  fireEvent.click(screen.getByText("Skip"));
}

describe("App smoke test", () => {
  it("shows onboarding on first run, and it can be dismissed", () => {
    render(<App />);
    expect(screen.getByText(/FlowCue AI listens, and never loses your place\./)).toBeInTheDocument();
    dismissOnboarding();
    expect(screen.queryByText(/FlowCue AI listens, and never loses your place\./)).not.toBeInTheDocument();
  });

  it("dismisses onboarding with the Escape key, for keyboard/screen-reader users", () => {
    render(<App />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a script card via the keyboard (Enter), not just a mouse click", () => {
    render(<App />);
    dismissOnboarding();
    fireEvent.click(screen.getByText("Try a sample script"));
    fireEvent.click(screen.getByText("Save Script"));
    fireEvent.click(screen.getByText("← Scripts"));

    const card = screen.getByRole("button", { name: /Open Sarah's Wedding Toast/i });
    fireEvent.keyDown(card, { key: "Enter" });
    expect(screen.getByText("Sarah's Wedding Toast")).toBeInTheDocument();
    // Distinguishes "opened the workspace" from "still on the library card":
    // the workspace header renders a back button the library never does.
    expect(screen.getByText("← Scripts")).toBeInTheDocument();
  });

  it("starts with an empty library, and creating a sample script opens the workspace", () => {
    render(<App />);
    dismissOnboarding();
    expect(screen.getByText(/Nothing rehearsed yet/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Try a sample script"));
    fireEvent.click(screen.getByText("Save Script"));

    // Workspace header shows the script title, and the rehearsal stage renders the
    // script as individual clickable word spans (not one contiguous text node).
    expect(screen.getByText("Sarah's Wedding Toast")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("tonight.")).toBeInTheDocument();
  });

  it("returns to the library and lists the created script as a card", () => {
    render(<App />);
    dismissOnboarding();
    fireEvent.click(screen.getByText("Try a sample script"));
    fireEvent.click(screen.getByText("Save Script"));

    fireEvent.click(screen.getByText("← Scripts"));
    expect(screen.getByText("Sarah's Wedding Toast")).toBeInTheDocument();
    // word count meta line should be present on the card
    expect(screen.getByText(/words · updated/)).toBeInTheDocument();
  });

  it("opens the pronunciation popover when a word in the stage is clicked", () => {
    render(<App />);
    dismissOnboarding();
    fireEvent.click(screen.getByText("Try a sample script"));
    fireEvent.click(screen.getByText("Save Script"));

    const wordEl = screen.getByText("Good");
    fireEvent.click(wordEl, { clientX: 100, clientY: 100 });

    expect(screen.getByText("Syllables")).toBeInTheDocument();
    expect(screen.getByText("Simplified")).toBeInTheDocument();
  });

  it("navigates to Settings and toggles the default visual mode", () => {
    render(<App />);
    dismissOnboarding();
    fireEvent.click(screen.getByText("Settings"));
    expect(screen.getByText("Default Visual Reading Mode")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Word karaoke"));
    // Toggling shouldn't throw, and the label should still be present.
    expect(screen.getByText("Word karaoke")).toBeInTheDocument();
  });

  it("deletes a script from the library", () => {
    render(<App />);
    dismissOnboarding();
    fireEvent.click(screen.getByText("Try a sample script"));
    fireEvent.click(screen.getByText("Save Script"));
    fireEvent.click(screen.getByText("← Scripts"));

    const card = screen.getByText("Sarah's Wedding Toast").closest(".scriptCard") as HTMLElement;
    const deleteBtn = within(card).getByRole("button", { name: /Delete/i });

    const originalConfirm = window.confirm;
    window.confirm = () => true;
    fireEvent.click(deleteBtn);
    window.confirm = originalConfirm;

    expect(screen.queryByText("Sarah's Wedding Toast")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing rehearsed yet/)).toBeInTheDocument();
  });
});
