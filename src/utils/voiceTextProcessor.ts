// ===========================================
// VOICE TEXT PREPROCESSOR
// Prepares AI response text for natural TTS output.
// Applied before sending to Inworld TTS.
// ===========================================

// Units and technical abbreviations that TTS engines mispronounce
const ABBREV_MAP: [RegExp, string][] = [
  // Units
  [/\blbs?\b/gi,          'pounds'],
  [/\bkgs?\b/gi,          'kilograms'],
  [/\bgrams?\b/gi,        'grams'],
  [/\bcms?\b/gi,          'centimeters'],
  [/\bmls?\b/gi,          'milliliters'],
  [/\bkcals?\b/gi,        'calories'],
  [/\bcals?\b/gi,         'calories'],
  // Fitness terms
  [/\b1RM\b/gi,           'one rep max'],
  [/\bRPE\b/gi,           'R.P.E.'],
  [/\bRIR\b/gi,           'reps in reserve'],
  [/\bDEXA\b/g,           'DEXA scan'],
  [/\bEMG\b/g,            'E.M.G.'],
  [/\bBMI\b/g,            'B.M.I.'],
  [/\bBMR\b/g,            'B.M.R.'],
  [/\bTDEE\b/g,           'T.D.E.E.'],
  // Common English abbreviations
  [/\be\.g\.\s*/gi,       'for example, '],
  [/\bi\.e\.\s*/gi,       'that is, '],
  [/\betc\./gi,           'et cetera'],
  [/\bvs\.\s*/gi,         'versus '],
  [/\bDr\./gi,            'Doctor'],
  [/\bMr\./gi,            'Mister'],
  [/\bMrs\./gi,           'Missus'],
  [/\bProf\./gi,          'Professor'],
  // Ranges and percentages that cause odd readings
  [/(\d+)\s*%/g,          '$1 percent'],
  [/(\d+)\s*x\s*(\d+)/gi, '$1 by $2'],   // "3x10" → "3 by 10"
];

// "2.7" → "2 point 7" so TTS doesn't say "two period seven"
function expandDecimals(text: string): string {
  return text.replace(/\b(\d+)\.(\d+)\b/g, '$1 point $2');
}

// Strip common markdown so it isn't read aloud literally
function stripMarkdownArtifacts(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')         // **bold**
    .replace(/\*(.*?)\*/g, '$1')              // *italic*
    .replace(/`{1,3}(.*?)`{1,3}/gs, '$1')    // `code` / ```block```
    .replace(/#{1,6}\s+/g, '')               // # headers
    .replace(/^\s*[-*+]\s+/gm, '')           // bullet list items
    .replace(/^\s*\d+\.\s+/gm, '')           // numbered list items
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url) → link text
    .replace(/^>\s*/gm, '')                  // > blockquotes
    .trim();
}

// Convert em-dashes / double-hyphens to comma pauses, normalise ellipses
function normalizePunctuation(text: string): string {
  return text
    .replace(/\s*—\s*/g, ', ')   // em-dash → comma (natural pause)
    .replace(/\s*--\s*/g, ', ')  // double hyphen → comma
    .replace(/…/g, '... ')       // unicode ellipsis → triple dot + space
    .replace(/\.\.\./g, '... ')  // ASCII ellipsis → triple dot + space
    .replace(/\n{2,}/g, '. ')    // blank lines → sentence boundary
    .replace(/\n/g, ', ')        // single newlines → comma pause
    .replace(/\s{2,}/g, ' ')     // collapse multiple spaces
    .trim();
}

function expandAbbreviations(text: string): string {
  let result = text;
  for (const [pattern, replacement] of ABBREV_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// Main export — call this on the AI response text before passing to any TTS provider
export function preprocessForTTS(text: string): string {
  let t = stripMarkdownArtifacts(text);
  t = expandAbbreviations(t);
  t = expandDecimals(t);
  t = normalizePunctuation(t);
  return t;
}
