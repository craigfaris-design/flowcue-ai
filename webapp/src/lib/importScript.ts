/**
 * Extracts a script title + body from an uploaded .docx or .txt file, so a
 * user can import an existing speech instead of retyping/pasting it.
 * Runs entirely client-side (mammoth.js parses the .docx locally in the
 * browser) -- consistent with the app's existing "nothing leaves this
 * device" storage model; the file is never uploaded anywhere.
 *
 * mammoth bundles JSZip and roughly triples the JS bundle size, so it's
 * dynamically imported only when a .docx is actually chosen rather than
 * loaded eagerly for every visitor (most of whom never import a file).
 */
export interface ImportedScript {
  title: string;
  body: string;
}

const SUPPORTED_EXTENSIONS = [".docx", ".txt"];

function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^./\\]+$/, "");
  const cleaned = withoutExtension.replace(/[_-]+/g, " ").trim();
  return cleaned || "Untitled script";
}

// mammoth's extractRawText tends to separate paragraphs with blank lines;
// the rest of the app (SAMPLE_BODY, tokenizeScript) treats one line as one
// paragraph with no blank lines between, so this normalizes to that shape
// rather than leaving inconsistent spacing depending on import source.
function normalizeBody(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export async function extractScriptFromFile(file: File): Promise<ImportedScript> {
  const lowerName = file.name.toLowerCase();
  const extension = SUPPORTED_EXTENSIONS.find((ext) => lowerName.endsWith(ext));

  if (!extension) {
    throw new Error("Unsupported file type -- please choose a .docx or .txt file.");
  }

  const title = titleFromFilename(file.name);

  if (extension === ".txt") {
    const text = await file.text();
    return { title, body: normalizeBody(text) };
  }

  // .docx
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    throw new Error("Could not read that file -- it may be corrupted or in use by another program.");
  }

  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.default.extractRawText({ arrayBuffer });
    return { title, body: normalizeBody(result.value) };
  } catch {
    // mammoth throws on a .docx that isn't actually a valid zip/OOXML doc
    // (e.g. a .doc renamed to .docx, or a genuinely corrupt file) -- surface
    // something the user can act on rather than a raw parser exception.
    throw new Error("Could not read that Word document -- it may be corrupted, password-protected, or not a real .docx file.");
  }
}
