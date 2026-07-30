import {
  FriendlyWordsRatingLabel,
} from 'cruzi-models';

export const RATING_MULTIPLIERS: Record<FriendlyWordsRatingLabel, number> = {
  'Not a Thing': 0,
  "It's a Stretch": 0.25,
  'I guess': 0.5,
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
