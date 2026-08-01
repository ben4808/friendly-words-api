import {
  FriendlyWordsBoardTile,
  FriendlyWordsPlacement,
  FriendlyWordsTile,
} from 'cruzi-models';
import { BOARD_SIZE } from './constants';
import { applyPlacementsToBoard, validatePlayGeometry } from './scoring';
import { serializeRack } from './tileUtils';

const COL_LETTERS = 'ABCDEFGHIJKLMNO';

function squareCoordinate(row: number, col: number, direction: 'across' | 'down'): string {
  const letter = COL_LETTERS[col];
  const number = row + 1;
  return direction === 'across' ? `${number}${letter}` : `${letter}${number}`;
}

function formatWordLetters(
  board: (FriendlyWordsBoardTile | null)[][],
  startRow: number,
  startCol: number,
  direction: 'across' | 'down',
  playedPositions: Set<string>
): string {
  let result = '';
  let row = startRow;
  let col = startCol;
  let pendingExisting = '';

  const flushExisting = () => {
    if (pendingExisting) {
      result += `(${pendingExisting})`;
      pendingExisting = '';
    }
  };

  while (row < BOARD_SIZE && col < BOARD_SIZE && board[row][col]) {
    const tile = board[row][col]!;
    const key = `${row},${col}`;
    const isNew = playedPositions.has(key);
    const ch = tile.isBlank ? tile.letter.toLowerCase() : tile.letter.toUpperCase();

    if (isNew) {
      flushExisting();
      result += ch;
    } else {
      pendingExisting += ch;
    }

    if (direction === 'across') col++;
    else row++;
  }
  flushExisting();
  return result;
}

export type PrincipalWordRef = {
  entry: string;
  direction: 'across' | 'down';
  startRow: number;
  startCol: number;
};

/**
 * Principal word: the one containing every newly placed tile when possible;
 * for a single tile, prefer across if that forms a word.
 */
export function findPrincipalWord<T extends PrincipalWordRef>(
  board: (FriendlyWordsBoardTile | null)[][],
  placements: FriendlyWordsPlacement[],
  words: T[]
): T {
  const playedPositions = new Set(placements.map((p) => `${p.row},${p.col}`));
  const tentative = applyPlacementsToBoard(board, placements, -1);

  let principal = words[0];
  if (placements.length === 1) {
    const across = words.find((w) => w.direction === 'across');
    principal = across ?? words[0];
  } else {
    const covering = words.find((word) => {
      let row = word.startRow;
      let col = word.startCol;
      const covered = new Set<string>();
      while (row < BOARD_SIZE && col < BOARD_SIZE && tentative[row][col]) {
        const key = `${row},${col}`;
        if (playedPositions.has(key)) covered.add(key);
        if (word.direction === 'across') col++;
        else row++;
      }
      return placements.every((p) => covered.has(`${p.row},${p.col}`));
    });
    if (covering) principal = covering;
  }
  return principal;
}

/**
 * Standard Scrabble play notation without the score, e.g. "8E Th(E)Y".
 * For exchanges: "Exch. AEL?".
 */
export function formatPlayAction(
  board: (FriendlyWordsBoardTile | null)[][],
  placements: FriendlyWordsPlacement[]
): string {
  const geometry = validatePlayGeometry(board, placements);
  if (!geometry.isValid || geometry.words.length === 0) {
    return 'play';
  }

  const playedPositions = new Set(placements.map((p) => `${p.row},${p.col}`));
  const tentative = applyPlacementsToBoard(board, placements, -1);
  const principal = findPrincipalWord(board, placements, geometry.words);

  const coord = squareCoordinate(principal.startRow, principal.startCol, principal.direction);
  const word = formatWordLetters(
    tentative,
    principal.startRow,
    principal.startCol,
    principal.direction,
    playedPositions
  );
  return `${coord} ${word}`;
}

export function formatExchangeAction(exchanged: FriendlyWordsTile[]): string {
  const letters = serializeRack(exchanged);
  return letters ? `Exch. ${letters}` : 'Exch.';
}
