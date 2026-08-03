import { describe, it, expect, vi } from "vitest";

vi.mock("mammoth", () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));

import mammoth from "mammoth";
import { extractScriptFromFile } from "./importScript";

function txtFile(name: string, content: string): File {
  return new File([content], name, { type: "text/plain" });
}

function docxFile(name: string): File {
  // Content doesn't matter for these tests -- mammoth.extractRawText is
  // mocked, so this is just a File with the right name/extension to route
  // through the .docx branch.
  return new File([new Uint8Array([0])], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

describe("extractScriptFromFile", () => {
  describe(".txt files", () => {
    it("reads the file's text content as the body", async () => {
      const result = await extractScriptFromFile(txtFile("my-speech.txt", "Hello everyone.\nThank you for coming."));
      expect(result.body).toBe("Hello everyone.\nThank you for coming.");
    });

    it("derives the title from the filename, stripping the extension", async () => {
      const result = await extractScriptFromFile(txtFile("Wedding Toast.txt", "body"));
      expect(result.title).toBe("Wedding Toast");
    });

    it("replaces underscores/hyphens in the filename with spaces for the title", async () => {
      const result = await extractScriptFromFile(txtFile("my_wedding-toast_final.txt", "body"));
      expect(result.title).toBe("my wedding toast final");
    });

    it("normalizes line endings and trims blank lines", async () => {
      const result = await extractScriptFromFile(txtFile("s.txt", "Line one.\r\n\r\n  Line two.  \n\n\nLine three."));
      expect(result.body).toBe("Line one.\nLine two.\nLine three.");
    });

    it("falls back to a generic title if the filename has no usable characters", async () => {
      const result = await extractScriptFromFile(txtFile("___.txt", "body"));
      expect(result.title).toBe("Untitled script");
    });

    it("is case-insensitive about the .txt extension", async () => {
      const result = await extractScriptFromFile(txtFile("speech.TXT", "body"));
      expect(result.body).toBe("body");
    });
  });

  describe(".docx files", () => {
    it("extracts raw text via mammoth and normalizes it the same way as .txt", async () => {
      vi.mocked(mammoth.extractRawText).mockResolvedValueOnce({
        value: "Paragraph one.\n\nParagraph two.\n\n",
        messages: [],
      });
      const result = await extractScriptFromFile(docxFile("My Speech.docx"));
      expect(result.title).toBe("My Speech");
      expect(result.body).toBe("Paragraph one.\nParagraph two.");
      expect(mammoth.extractRawText).toHaveBeenCalledWith(expect.objectContaining({ arrayBuffer: expect.anything() }));
    });

    it("surfaces a clear, actionable error if mammoth fails to parse the file", async () => {
      vi.mocked(mammoth.extractRawText).mockRejectedValueOnce(new Error("not a valid zip"));
      await expect(extractScriptFromFile(docxFile("broken.docx"))).rejects.toThrow(/could not read that word document/i);
    });
  });

  describe("unsupported file types", () => {
    it("rejects a file extension it doesn't recognize", async () => {
      const file = new File(["data"], "photo.png", { type: "image/png" });
      await expect(extractScriptFromFile(file)).rejects.toThrow(/unsupported file type/i);
    });

    it("rejects a file with no extension at all", async () => {
      const file = new File(["data"], "README", { type: "" });
      await expect(extractScriptFromFile(file)).rejects.toThrow(/unsupported file type/i);
    });
  });
});
