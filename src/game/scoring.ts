import {
  FriendlyWordsBoardTile,
  FriendlyWordsPlacement,
  FriendlyWordsTile,
} from 'cruzi-models';
import {
  BOARD_SIZE,
  DOUBLE_LETTER_SQUARES,
  DOUBLE_WORD_SQUARES,
  TRIPLE_LETTER_SQUARES,
  TRIPLE_WORD_SQUARES,
} from './constants';

export type FormedWord = {
  entry: string;
  direction: 'across' | 'down';
  startRow: number;
  startCol: number;
  grossScore: number;
};

export type PlayGeometryResult = {
  isValid: boolean;
  invalidReason?: string;
  words: FormedWord[];
  grossScore: number;
};

const getLetterMultiplier = (row: number, col: number): number => {
  if (TRIPLE_LETTER_SQUARES.some(([r, c]) => r === row && c === col)) return 3;
  if (DOUBLE_LETTER_SQUARES.some(([r, c]) => r === row && c === col)) return 2;
  return 1;
};

const getWordMultiplier = (row: number, col: number): number => {
  if (TRIPLE_WORD_SQUARES.some(([r, c]) => r === row && c === col)) return 3;
  if (DOUBLE_WORD_SQUARES.some(([r, c]) => r === row && c === col)) return 2;
  return 1;
};

export const validateContinuousLine = (
  board: (FriendlyWordsBoardTile | null)[][],
  currentPlay: FriendlyWordsPlacement[]
): boolean => {
  if (currentPlay.length <= 1) return true;

  const rows = new Set(currentPlay.map((play) => play.row));
  const cols = new Set(currentPlay.map((play) => play.col));
  const isHorizontal = rows.size === 1;
  const isVertical = cols.size === 1;
  if (!isHorizontal && !isVertical) return false;

  const positions = currentPlay.map((play) => ({ row: play.row, col: play.col }));

  if (isHorizontal) {
    positions.sort((a, b) => a.col - b.col);
    const row = positions[0].row;
    for (let i = 0; i < positions.length - 1; i++) {
      for (let col = positions[i].col + 1; col < positions[i + 1].col; col++) {
        if (!board[row][col]) return false;
      }
    }
  } else {
    positions.sort((a, b) => a.row - b.row);
    const col = positions[0].col;
    for (let i = 0; i < positions.length - 1; i++) {
      for (let row = positions[i].row + 1; row < positions[i + 1].row; row++) {
        if (!board[row][col]) return false;
      }
    }
  }

  return true;
};

const findWordStart = (
  board: (FriendlyWordsBoardTile | null)[][],
  row: number,
  col: number,
  direction: 'across' | 'down'
): { startRow: number; startCol: number } => {
  let startRow = row;
  let startCol = col;
  if (direction === 'across') {
    while (startCol > 0 && board[startRow][startCol - 1]) startCol--;
  } else {
    while (startRow > 0 && board[startRow - 1][startCol]) startRow--;
  }
  return { startRow, startCol };
};

const extractWord = (
  board: (FriendlyWordsBoardTile | null)[][],
  startRow: number,
  startCol: number,
  direction: 'across' | 'down'
): string => {
  let word = '';
  let row = startRow;
  let col = startCol;
  while (row < BOARD_SIZE && col < BOARD_SIZE && board[row][col]) {
    word += board[row][col]!.letter;
    if (direction === 'across') col++;
    else row++;
  }
  return word;
};

const findUniqueWords = (
  board: (FriendlyWordsBoardTile | null)[][],
  currentPlay: FriendlyWordsPlacement[]
): { startRow: number; startCol: number; direction: 'across' | 'down' }[] => {
  const uniqueWords = new Set<string>();
  for (const play of currentPlay) {
    const acrossStart = findWordStart(board, play.row, play.col, 'across');
    uniqueWords.add(`across-${acrossStart.startRow}-${acrossStart.startCol}`);
    const downStart = findWordStart(board, play.row, play.col, 'down');
    uniqueWords.add(`down-${downStart.startRow}-${downStart.startCol}`);
  }

  return Array.from(uniqueWords)
    .map((key) => {
      const [direction, startRow, startCol] = key.split('-');
      return {
        startRow: parseInt(startRow, 10),
        startCol: parseInt(startCol, 10),
        direction: direction as 'across' | 'down',
      };
    })
    .filter((word) => extractWord(board, word.startRow, word.startCol, word.direction).length > 1);
};

const wordIncludesExistingTile = (
  board: (FriendlyWordsBoardTile | null)[][],
  startRow: number,
  startCol: number,
  direction: 'across' | 'down',
  playedPositions: Set<string>
): boolean => {
  let row = startRow;
  let col = startCol;
  while (row < BOARD_SIZE && col < BOARD_SIZE && board[row][col]) {
    if (!playedPositions.has(`${row},${col}`)) return true;
    if (direction === 'across') col++;
    else row++;
  }
  return false;
};

const calculateWordScore = (
  board: (FriendlyWordsBoardTile | null)[][],
  startRow: number,
  startCol: number,
  direction: 'across' | 'down',
  playedPositions: Set<string>
): number => {
  let adjustedScore = 0;
  let wordMultiplier = 1;
  let row = startRow;
  let col = startCol;

  while (row < BOARD_SIZE && col < BOARD_SIZE && board[row][col]) {
    const tile = board[row][col]!;
    const positionKey = `${row},${col}`;
    if (playedPositions.has(positionKey)) {
      adjustedScore += tile.value * getLetterMultiplier(row, col);
      wordMultiplier *= getWordMultiplier(row, col);
    } else {
      adjustedScore += tile.value;
    }
    if (direction === 'across') col++;
    else row++;
  }

  return adjustedScore * wordMultiplier;
};

export const applyPlacementsToBoard = (
  board: (FriendlyWordsBoardTile | null)[][],
  placements: FriendlyWordsPlacement[],
  playedBy: number
): (FriendlyWordsBoardTile | null)[][] => {
  const next = board.map((row) => [...row]);
  for (const placement of placements) {
    next[placement.row][placement.col] = {
      letter: placement.letter,
      value: placement.value,
      isBlank: placement.isBlank,
      playedBy,
    };
  }
  return next;
};

export const validatePlayGeometry = (
  board: (FriendlyWordsBoardTile | null)[][],
  placements: FriendlyWordsPlacement[]
): PlayGeometryResult => {
  if (placements.length === 0) {
    return { isValid: false, invalidReason: 'No tiles played', words: [], grossScore: 0 };
  }

  for (const placement of placements) {
    if (
      placement.row < 0 ||
      placement.col < 0 ||
      placement.row >= BOARD_SIZE ||
      placement.col >= BOARD_SIZE
    ) {
      return { isValid: false, invalidReason: 'Tile out of bounds', words: [], grossScore: 0 };
    }
    if (board[placement.row][placement.col]) {
      return { isValid: false, invalidReason: 'Square already occupied', words: [], grossScore: 0 };
    }
  }

  if (!validateContinuousLine(board, placements)) {
    return {
      isValid: false,
      invalidReason: 'Tiles must be placed in one continuous line',
      words: [],
      grossScore: 0,
    };
  }

  const tentativeBoard = applyPlacementsToBoard(board, placements, -1);
  const playedPositions = new Set(placements.map((play) => `${play.row},${play.col}`));
  const uniqueWords = findUniqueWords(tentativeBoard, placements);

  if (uniqueWords.length === 0) {
    return { isValid: false, invalidReason: 'Play must form a word', words: [], grossScore: 0 };
  }

  const hasExistingTiles = board.some((row) => row.some((tile) => tile != null));
  if (!hasExistingTiles) {
    const coversCenter = placements.some((play) => play.row === 7 && play.col === 7);
    if (!coversCenter) {
      return {
        isValid: false,
        invalidReason: 'First word must cover the center square',
        words: [],
        grossScore: 0,
      };
    }
  } else {
    const connects = uniqueWords.some(({ startRow, startCol, direction }) =>
      wordIncludesExistingTile(tentativeBoard, startRow, startCol, direction, playedPositions)
    );
    if (!connects) {
      return {
        isValid: false,
        invalidReason: 'At least one word must include existing tiles',
        words: [],
        grossScore: 0,
      };
    }
  }

  const words: FormedWord[] = uniqueWords.map(({ startRow, startCol, direction }) => ({
    entry: extractWord(tentativeBoard, startRow, startCol, direction),
    direction,
    startRow,
    startCol,
    grossScore: calculateWordScore(tentativeBoard, startRow, startCol, direction, playedPositions),
  }));

  const grossScore = words.reduce((sum, word) => sum + word.grossScore, 0);
  return { isValid: true, words, grossScore };
};

export type { FriendlyWordsTile };
