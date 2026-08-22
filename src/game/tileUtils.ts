import { FriendlyWordsLanguage, FriendlyWordsTile } from 'cruzi-models';

const ENGLISH_VALUES: Record<string, number> = {
  A: 1, E: 1, I: 1, O: 1, U: 1, L: 1, N: 1, S: 1, T: 1, R: 1,
  D: 2, G: 2,
  B: 3, C: 3, M: 3, P: 3,
  F: 4, H: 4, V: 4, W: 4, Y: 4,
  K: 5,
  J: 8, X: 8,
  Q: 10, Z: 10,
};

const SPANISH_VALUES: Record<string, number> = {
  A: 1, E: 1, O: 1, I: 1, S: 1, N: 1, L: 1, R: 1, U: 1, T: 1,
  D: 2, G: 2,
  C: 3, B: 3, M: 3, P: 3,
  F: 4, H: 4, V: 4, Y: 4,
  CH: 5, Q: 5,
  J: 8, LL: 8, Ñ: 8, RR: 8, X: 8,
  Z: 10,
};

const ENGLISH_DISTRIBUTION: Record<string, number> = {
  A: 9, B: 2, C: 2, D: 4, E: 12,
  F: 2, G: 3, H: 2, I: 9, J: 1,
  K: 1, L: 4, M: 2, N: 6, O: 8,
  P: 2, Q: 1, R: 6, S: 4, T: 6,
  U: 4, V: 2, W: 2, X: 1, Y: 2,
  Z: 1, '?': 2,
};

/** Official Spanish Scrabble distribution (includes digraph tiles CH, LL, RR). */
const SPANISH_DISTRIBUTION: Record<string, number> = {
  A: 12, B: 2, C: 4, CH: 1, D: 5, E: 12,
  F: 1, G: 2, H: 2, I: 6, J: 1,
  L: 4, LL: 1, M: 2, N: 5, Ñ: 1, O: 9,
  P: 2, Q: 1, R: 5, RR: 1, S: 6, T: 4,
  U: 5, V: 1, X: 1, Y: 1, Z: 1, '?': 2,
};

export const normalizeLanguage = (language?: string | null): FriendlyWordsLanguage =>
  language === 'es' ? 'es' : 'en';

export const getTileValue = (
  letter: string,
  language: FriendlyWordsLanguage = 'en'
): number => {
  const key = letter.toUpperCase();
  const values = language === 'es' ? SPANISH_VALUES : ENGLISH_VALUES;
  return values[key] || 0;
};

export const createTilePool = (
  language: FriendlyWordsLanguage = 'en'
): FriendlyWordsTile[] => {
  const distribution = language === 'es' ? SPANISH_DISTRIBUTION : ENGLISH_DISTRIBUTION;
  const pool: FriendlyWordsTile[] = [];

  for (const [letter, count] of Object.entries(distribution)) {
    for (let i = 0; i < count; i++) {
      pool.push({
        letter: letter === '?' ? '' : letter,
        value: letter === '?' ? 0 : getTileValue(letter, language),
      });
    }
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool;
};

export const drawTiles = (
  pool: FriendlyWordsTile[],
  count: number
): { tiles: FriendlyWordsTile[]; remainingPool: FriendlyWordsTile[] } => {
  const tiles = pool.slice(0, Math.min(count, pool.length));
  const remainingPool = pool.slice(Math.min(count, pool.length));
  return { tiles, remainingPool };
};

const sortedRackLetters = (rack: FriendlyWordsTile[]): string[] =>
  rack
    .map((tile) => (tile.letter === '' ? '?' : tile.letter.toUpperCase()))
    .sort((a, b) => {
      if (a === '?') return 1;
      if (b === '?') return -1;
      return a.localeCompare(b);
    });

/** Serialize rack letters alphabetically, with blanks (`?`) last. */
export const serializeRack = (rack: FriendlyWordsTile[]): string =>
  sortedRackLetters(rack).join('');

/** Human-readable leftover tiles for end-game toasts (`Q X J`). */
export const formatRackTiles = (rack: FriendlyWordsTile[]): string =>
  sortedRackLetters(rack).join(' ');
