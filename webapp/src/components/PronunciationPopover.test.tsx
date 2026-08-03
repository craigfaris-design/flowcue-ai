import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { PronunciationPopover } from "./PronunciationPopover";

describe("PronunciationPopover -- accessibility", () => {
  it("is announced as a dialog labeled with the word, not an anonymous div", () => {
    const { container } = render(<PronunciationPopover word="rehearsal" x={10} y={10} onClose={() => {}} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-label")).toMatch(/rehearsal/i);
  });

  it("moves focus into itself on open, and restores focus to the triggering element on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<PronunciationPopover word="rehearsal" x={10} y={10} onClose={() => {}} />);
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("closes on Escape, not just a click outside", () => {
    const onClose = vi.fn();
    render(<PronunciationPopover word="rehearsal" x={10} y={10} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on an unrelated key", () => {
    const onClose = vi.fn();
    render(<PronunciationPopover word="rehearsal" x={10} y={10} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clamps position so it never renders off the left/top edge of the viewport", () => {
    const { container } = render(<PronunciationPopover word="rehearsal" x={-50} y={-50} onClose={() => {}} />);
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.style.left).toBe("0px");
    expect(dialog.style.top).toBe("0px");
  });
});
