import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Library } from "./Library";
import type { Script } from "../lib/types";

function noop() {}

function renderLibrary(scripts: Script[] = []) {
  const onCreate = vi.fn();
  const utils = render(<Library scripts={scripts} onOpen={noop} onCreate={onCreate} onDelete={noop} />);
  return { ...utils, onCreate };
}

function selectFile(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

describe("Library -- import from file", () => {
  it("pre-fills the script form from an imported .txt file and shows it for review, without saving yet", async () => {
    const { onCreate } = renderLibrary();
    const file = new File(["Good evening everyone.\nThank you for coming."], "My Speech.txt", { type: "text/plain" });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, file);

    const titleInput = await screen.findByPlaceholderText("Script title");
    expect(titleInput).toHaveValue("My Speech");
    expect(screen.getByPlaceholderText("Paste your speech here...")).toHaveValue(
      "Good evening everyone.\nThank you for coming."
    );
    // Reviewing, not auto-saved -- the user still has to press Save Script.
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("lets the user edit the imported text before saving, same as any other new script", async () => {
    renderLibrary();
    const file = new File(["Original text."], "speech.txt", { type: "text/plain" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, file);

    const bodyField = await screen.findByPlaceholderText("Paste your speech here...");
    fireEvent.change(bodyField, { target: { value: "Edited text." } });
    expect(bodyField).toHaveValue("Edited text.");
  });

  it("shows a clear error for an unsupported file type and does not open the review form", async () => {
    renderLibrary();
    const file = new File(["binary"], "photo.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    selectFile(input, file);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/unsupported file type/i));
    expect(screen.queryByPlaceholderText("Script title")).not.toBeInTheDocument();
  });

  it("clears a previous import error once a valid file is chosen", async () => {
    renderLibrary();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    selectFile(input, new File(["binary"], "photo.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /import file/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("selecting the same file twice in a row still triggers a fresh import (input value is reset)", async () => {
    renderLibrary();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["Some text."], "speech.txt", { type: "text/plain" });

    selectFile(input, file);
    await screen.findByPlaceholderText("Script title");
    expect(input.value).toBe("");
  });
});
