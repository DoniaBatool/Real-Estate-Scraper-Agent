/**
 * Text for `SpeechSynthesisUtterance` only. Browsers speak CLDR names for emoji
 * ("waving hand", "smiling face with smiling eyes"); UI should still show the original string.
 */
export function stripEmojisForSpeech(input: string): string {
  if (!input) return "";
  let s = input.normalize("NFKC");
  // Core emoji pictographs (👋 😊 etc.)
  s = s.replace(/\p{Extended_Pictographic}/gu, "");
  // Joiners / presentation selectors left behind from sequences
  s = s.replace(/[\uFE0F\u200D]+/gu, "");
  // Fitzpatrick skin-tone modifiers
  s = s.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "");
  // Regional-indicator pairs (flags) — often read as letter names
  s = s.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}
