import { FriendlyWordsTile } from 'cruzi-models';

export const getTileValue = (letter: string): number => {
  const values: Record<string, number> = {
    A: 1, E: 1, I: 1, O: 1, U: 1, L: 1, N: 1, S: 1, T: 1, R: 1,
    D: 2, G: 2,
    B: 3, C: 3, M: 3, P: 3,
    F: 4, H: 4, V: 4, W: 4, Y: 4,
    K: 5,
    J: 8, X: 8,
    Q: 10, Z: 10,
  };
  return values[letter.toUpperCase()] || 0;
};

export const createTilePool = (): FriendlyWordsTile[] => {
  const distribution: Record<string, number> = {
    A: 9, B: 2, C: 2, D: 4, E: 12,
    F: 2, G: 3, H: 2, I: 9, J: 1,
    K: 1, L: 4, M: 2, N: 6, O: 8,
    P: 2, Q: 1, R: 6, S: 4, T: 6,
    U: 4, V: 2, W: 2, X: 1, Y: 2,
    Z: 1, '?': 2,
  };

  const pool: FriendlyWordsTile[] = [];
  for (const [letter, count] of Object.entries(distribution)) {
    for (let i = 0; i < count; i++) {
      pool.push({
        letter: letter === '?' ? '' : letter,
        value: letter === '?' ? 0 : getTileValue(letter),
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

export const serializeRack = (rack: FriendlyWordsTile[]): string => {
  return rack.map((tile) => (tile.letter === '' ? '?' : tile.letter)).join('');
};
