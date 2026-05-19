// ===========================================
// PROFANITY FILTER & TOXICITY DETECTION
// ===========================================

// Profanity word lists (sample - expand in production)
const englishProfanity = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'damn', 'hell',
  'cunt', 'dick', 'pussy', 'cock', 'whore', 'slut', 'fag',
  'nigger', 'retard', 'rape', 'nazi', 'terrorist'
];

const hindiProfanity = [
  // Hindi/Hinglish profanity (Romanized)
  'bhenchod', 'madarchod', 'chutiya', 'chutiye', 'gandu', 'harami',
  'kutte', 'kutta', 'saala', 'saali', 'kamina', 'kamine',
  'randi', 'prostitute', 'hijra', 'chakka', 'behenchod',
  'mc', 'bc', 'lund', 'lode', 'gaand', 'gand', 'bhosdike',
  // Devanagari script versions would also be added
  'मादरचोद', 'भेनचोद', 'चूतिया', 'गांडू', 'हरामी', 'कुत्ता', 'रंडी'
];

// Combine all profanity lists
const allProfanity = [...englishProfanity, ...hindiProfanity];

// Toxic patterns
const toxicPatterns = [
  /kill\s+yourself/i,
  /kys/i,
  /die\s+in/i,
  /i\s+hope\s+you\s+die/i,
  /you\s+should\s+die/i,
  /suicide/i,
  /end\s+your\s+life/i
];

// Hate speech patterns
const hateSpeechPatterns = [
  /fucking\s+muslim/i,
  /fucking\s+hindu/i,
  /all\s+muslims\s+are/i,
  /all\s+hindus\s+are/i,
  /jews\s+are/i,
  /christians\s+are/i
];

// ===========================================
// CHECK IF TEXT CONTAINS PROFANITY
// ===========================================

export const containsProfanity = (text: string): boolean => {
  const lowerText = text.toLowerCase();

  // Check against profanity list
  for (const word of allProfanity) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(lowerText)) {
      return true;
    }
  }

  // Check toxic patterns
  for (const pattern of toxicPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  // Check hate speech patterns
  for (const pattern of hateSpeechPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
};

// ===========================================
// GET FLAGGED WORDS FROM TEXT
// ===========================================

export const getFlaggedWords = (text: string): string[] => {
  const lowerText = text.toLowerCase();
  const flagged: string[] = [];

  // Check profanity words
  for (const word of allProfanity) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(lowerText)) {
      flagged.push(word);
    }
  }

  // Check toxic patterns
  for (const pattern of toxicPatterns) {
    if (pattern.test(text)) {
      flagged.push('toxic_language');
      break;
    }
  }

  // Check hate speech patterns
  for (const pattern of hateSpeechPatterns) {
    if (pattern.test(text)) {
      flagged.push('hate_speech');
      break;
    }
  }

  return [...new Set(flagged)]; // Remove duplicates
};

// ===========================================
// CLEAN PROFANITY (REPLACE WITH ASTERISKS)
// ===========================================

export const cleanProfanity = (text: string): string => {
  let cleanedText = text;

  for (const word of allProfanity) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    cleanedText = cleanedText.replace(regex, (match) => {
      return '*'.repeat(match.length);
    });
  }

  return cleanedText;
};

// ===========================================
// CALCULATE TOXICITY SCORE (0-1)
// ===========================================

export const getToxicityScore = (text: string): number => {
  let score = 0;
  const lowerText = text.toLowerCase();

  // Count profanity words (each adds 0.1)
  let profanityCount = 0;
  for (const word of allProfanity) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) {
      profanityCount += matches.length;
    }
  }
  score += Math.min(profanityCount * 0.1, 0.5); // Max 0.5 from profanity

  // Toxic patterns (each adds 0.3)
  for (const pattern of toxicPatterns) {
    if (pattern.test(text)) {
      score += 0.3;
      break; // Only count once
    }
  }

  // Hate speech (adds 0.4)
  for (const pattern of hateSpeechPatterns) {
    if (pattern.test(text)) {
      score += 0.4;
      break; // Only count once
    }
  }

  // All caps (adds 0.1 if more than 50% is caps)
  const capsPercentage = (text.match(/[A-Z]/g) || []).length / text.length;
  if (capsPercentage > 0.5 && text.length > 10) {
    score += 0.1;
  }

  // Excessive punctuation (adds 0.1)
  const punctuationCount = (text.match(/[!?]{2,}/g) || []).length;
  if (punctuationCount > 2) {
    score += 0.1;
  }

  return Math.min(score, 1); // Cap at 1.0
};

// ===========================================
// SHOULD AUTO-FLAG MESSAGE
// ===========================================

export const shouldAutoFlag = (text: string): boolean => {
  const toxicityScore = getToxicityScore(text);

  // Auto-flag if toxicity score is above 0.6
  if (toxicityScore >= 0.6) {
    return true;
  }

  // Auto-flag if contains hate speech
  for (const pattern of hateSpeechPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  // Auto-flag if contains multiple severe profanities
  const flaggedWords = getFlaggedWords(text);
  const severeProfanity = ['rape', 'terrorist', 'nazi', 'nigger', 'madarchod', 'bhenchod'];
  const severeFlagged = flaggedWords.filter(word => severeProfanity.includes(word));

  if (severeFlagged.length > 0) {
    return true;
  }

  return false;
};

// ===========================================
// GET MODERATION RECOMMENDATION
// ===========================================

export interface ModerationRecommendation {
  shouldFlag: boolean;
  toxicityScore: number;
  flaggedWords: string[];
  recommendedAction: 'none' | 'warning' | 'hide' | 'ban';
  reason: string;
}

export const getModerationRecommendation = (text: string): ModerationRecommendation => {
  const toxicityScore = getToxicityScore(text);
  const flaggedWords = getFlaggedWords(text);
  const shouldFlag = shouldAutoFlag(text);

  let recommendedAction: 'none' | 'warning' | 'hide' | 'ban' = 'none';
  let reason = '';

  if (toxicityScore >= 0.8) {
    recommendedAction = 'ban';
    reason = 'Severe toxic content detected';
  } else if (toxicityScore >= 0.6) {
    recommendedAction = 'hide';
    reason = 'High toxicity content';
  } else if (toxicityScore >= 0.4) {
    recommendedAction = 'warning';
    reason = 'Moderate profanity detected';
  } else if (flaggedWords.length > 0) {
    recommendedAction = 'warning';
    reason = 'Profanity detected';
  }

  return {
    shouldFlag,
    toxicityScore,
    flaggedWords,
    recommendedAction,
    reason
  };
};

// ===========================================
// EXPORT PROFANITY LIST (FOR TESTING)
// ===========================================

export const getProfanityList = () => ({
  english: englishProfanity,
  hindi: hindiProfanity,
  all: allProfanity
});
