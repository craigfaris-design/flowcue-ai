import { describe, it, expect } from "vitest";
import { resolveLanguage } from "./sttRelay.js";

describe("resolveLanguage", () => {
  it("passes through a supported language", () => {
    expect(resolveLanguage("/api/stt-relay?language=fr-FR")).toBe("fr-FR");
  });

  it("defaults to en-US when there's no language param at all", () => {
    expect(resolveLanguage("/api/stt-relay")).toBe("en-US");
  });

  it("defaults to en-US when the request URL is undefined", () => {
    expect(resolveLanguage(undefined)).toBe("en-US");
  });

  it("falls back to en-US for a language not in the allowlist, instead of forwarding it to AssemblyAI", () => {
    // Guards the actual security property: an unrecognized/malicious value
    // (e.g. an attempt to inject extra query params into the outbound
    // AssemblyAI URL) never reaches assemblyAiUrl() as-is.
    expect(resolveLanguage("/api/stt-relay?language=xx-YY")).toBe("en-US");
  });

  it("falls back to en-US for an empty language param", () => {
    expect(resolveLanguage("/api/stt-relay?language=")).toBe("en-US");
  });

  it("is not fooled by attempted query-string injection in the language value", () => {
    const malicious = "/api/stt-relay?" + new URLSearchParams({ language: "en-US&model=whisper" }).toString();
    expect(resolveLanguage(malicious)).toBe("en-US");
  });

  it("accepts every language in the documented supported set", () => {
    for (const code of ["en-US", "es-ES", "fr-FR", "de-DE", "pt-BR", "it-IT", "nl-NL", "hi-IN", "ko-KR", "ru-RU"]) {
      expect(resolveLanguage(`/api/stt-relay?language=${code}`)).toBe(code);
    }
  });
});
