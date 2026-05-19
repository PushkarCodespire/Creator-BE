import Filter from 'bad-words';

const filter = new Filter();

// Romanized Hindi profanity added to the bad-words filter (handles Latin word boundaries)
filter.addWords(
  'madarchod', 'madarchodd', 'maakaankh', 'maakiaankh',
  'bhenchod', 'benchod', 'behenchod', 'behnchod', 'bsdk',
  'chutiya', 'chutia', 'chut', 'choot',
  'gaand', 'gand', 'gaandu', 'ganду', 'gandu',
  'lund', 'lauda', 'loda', 'lavda',
  'randi', 'raand', 'rand',
  'harami', 'haramzada', 'haramjaada', 'haramkhor',
  'kamina', 'kameena',
  'bakchod', 'bakchodi',
  'bhadwa', 'bhadua',
  'kutiya', 'kutia', 'kutti',
  'bosadi', 'bosdi', 'bhosdike', 'bhosdika', 'bhosad',
  'jhaat', 'jhatu',
  'tatti',
  'saala', 'sala',
  'ullu', 'ulluke',
);

// Devanagari Hindi profanity — handled separately because \b word boundaries
// in bad-words don't apply to non-Latin Unicode scripts
const DEVANAGARI_WORDS: string[] = [
  'मादरचोद', 'माँ की आँख', 'मां की आंख',
  'भेनचोद', 'भड़वा', 'भड़वे',
  'चूतिया', 'चूत', 'चुत',
  'गांड', 'गाण्ड', 'गांडू',
  'लंड', 'लौड़ा', 'लवड़ा',
  'रंडी', 'रांड',
  'हरामी', 'हरामजादा', 'हरामखोर',
  'कमीना', 'कमीने',
  'बकचोद', 'बकचोदी',
  'कुतिया', 'कुत्ती',
  'बोसड़ी',
  'झाट',
  'टट्टी',
  'साला', 'साली',
];

// Pre-compile regexes once at module load for performance
const DEVANAGARI_REGEXES: { re: RegExp; replacement: string }[] = DEVANAGARI_WORDS.map(word => ({
  re: new RegExp(word, 'g'),
  replacement: '*'.repeat(word.length),
}));

function sanitizeDevanagari(text: string): string {
  let result = text;
  for (const { re, replacement } of DEVANAGARI_REGEXES) {
    result = result.replace(re, replacement);
  }
  return result;
}

export function sanitizeMessage(text: string): string {
  if (!text.trim()) return text;
  const devanagariCleaned = sanitizeDevanagari(text);
  try {
    return filter.clean(devanagariCleaned);
  } catch {
    // bad-words can throw on edge-case inputs; return Devanagari-cleaned version
    return devanagariCleaned;
  }
}
