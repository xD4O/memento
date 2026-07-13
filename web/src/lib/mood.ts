export type Valence = "positive" | "negative" | "neutral";

const POSITIVE = new Set([
  "happy", "upbeat", "excited", "engaged", "inspired", "focused", "content",
  "grateful", "optimistic", "energized", "proud", "calm", "relaxed",
  "accomplished", "hopeful", "motivated", "joyful", "cheerful", "confident",
  "productive", "satisfied", "enthusiastic",
]);
const NEGATIVE = new Set([
  "sad", "tired", "anxious", "stressed", "frustrated", "angry", "down",
  "overwhelmed", "worried", "drained", "lonely", "exhausted", "upset",
  "discouraged", "irritated", "gloomy", "restless", "tense",
]);

export function valence(mood: string | null | undefined): Valence {
  if (!mood) return "neutral";
  const m = mood.toLowerCase().trim();
  if (POSITIVE.has(m)) return "positive";
  if (NEGATIVE.has(m)) return "negative";
  return "neutral";
}

// Chart mark colors — validated (dataviz six checks) against surface #0C1016.
// UI accent tints (--amber/--cyan) are too light for marks; text wears ink.
export const CHART = {
  amber: "#C07716",
  cyan: "#0E96AC",
  violet: "#7B5CD6",
  green: "#458A3D",
  negative: "#E5484D",
  neutral: "#4A5568",
};

export const VALENCE_COLOR: Record<Valence, string> = {
  positive: CHART.cyan,
  negative: CHART.negative,
  neutral: CHART.neutral,
};
