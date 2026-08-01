import {
  FriendlyWordsConfirmation,
  FriendlyWordsConfirmationWord,
  FriendlyWordsRatingLabel,
} from 'cruzi-models';

export const RATING_MULTIPLIERS: Record<FriendlyWordsRatingLabel, number> = {
  'Not a Thing': 0,
  "It's a Stretch": 0.25,
  Obscure: 0.5,
  Meh: 0.75,
  Good: 1,
  Cool: 1.25,
  Amazing: 1.5,
};

export const DEFAULT_RATING_LABEL: FriendlyWordsRatingLabel = 'Good';

export function isRatingLabel(value: string): value is FriendlyWordsRatingLabel {
  return Object.prototype.hasOwnProperty.call(RATING_MULTIPLIERS, value);
}

export function getRatingMultiplier(label: FriendlyWordsRatingLabel): number {
  return RATING_MULTIPLIERS[label];
}

export function productOfMultipliers(multipliers: number[]): number {
  return multipliers.reduce((acc, value) => acc * value, 1);
}

export function maxRatingLabel(labels: FriendlyWordsRatingLabel[]): FriendlyWordsRatingLabel {
  if (labels.length === 0) return DEFAULT_RATING_LABEL;
  return labels.reduce((best, label) =>
    getRatingMultiplier(label) > getRatingMultiplier(best) ? label : best
  );
}

/**
 * Recompute consensus labels/scores from opponents' current ratings.
 * Uses every slider selection already recorded (not only confirmed),
 * so totals update live as opponents move sliders.
 * Bingo (+50) is already included in the principal word's grossScore.
 */
export function recomputeConfirmationConsensus(confirmation: FriendlyWordsConfirmation): void {
  for (const word of confirmation.words) {
    const ratedLabels = Object.values(word.opponentRatings)
      .map((rating) => rating.ratingLabel)
      .filter((label): label is FriendlyWordsRatingLabel => Boolean(label));

    const consensus =
      ratedLabels.length > 0
        ? maxRatingLabel(ratedLabels)
        : word.recommendedLabel;

    word.ratingLabel = consensus;
    word.multiplier = getRatingMultiplier(consensus);
  }

  const wordGross = confirmation.words.reduce((sum, w) => sum + w.grossScore, 0);
  confirmation.totalMultiplier = productOfMultipliers(
    confirmation.words.map((w) => w.multiplier)
  );
  confirmation.netScore = Math.round(wordGross * confirmation.totalMultiplier);
}

export function ensureOpponentRating(
  word: FriendlyWordsConfirmationWord,
  playerId: string
): FriendlyWordsRatingLabel {
  const existing = word.opponentRatings[playerId];
  if (existing) return existing.ratingLabel;
  word.opponentRatings[playerId] = {
    ratingLabel: word.recommendedLabel,
    wasUpdated: false,
  };
  return word.recommendedLabel;
}
