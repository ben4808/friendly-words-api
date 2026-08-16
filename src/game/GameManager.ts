import CruziDao from 'cruzi-db';
import {
  FriendlyWordsConfirmation,
  FriendlyWordsGame,
  FriendlyWordsGameState,
  FriendlyWordsLanguage,
  FriendlyWordsLivePlay,
  FriendlyWordsPlacement,
  FriendlyWordsPlayer,
  FriendlyWordsPlayedWord,
  FriendlyWordsRating,
  FriendlyWordsRatingLabel,
  FriendlyWordsTurn,
} from 'cruzi-models';
import { BOARD_SIZE, BINGO_BONUS, MAX_PLAYERS, RACK_SIZE } from './constants';
import { findPrincipalWord, formatExchangeAction, formatPlayAction } from './notation';
import { applyPlacementsToBoard, validatePlayGeometry } from './scoring';
import {
  createTilePool,
  drawTiles,
  getTileValue,
  normalizeLanguage,
  serializeRack,
} from './tileUtils';
import {
  generateEntityId,
  generateGameCode,
  generateGameId,
  generatePlayerId,
  generatePlayerToken,
} from '../lib/ids';
import {
  DEFAULT_RATING_LABEL,
  ensureOpponentRating,
  getRatingMultiplier,
  isRatingLabel,
  productOfMultipliers,
  recomputeConfirmationConsensus,
} from '../lib/ratings';

export class GameError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export type PublicPlayer = Omit<FriendlyWordsPlayer, 'token' | 'rack'> & {
  rackCount: number;
};

export type PublicGameView = {
  id: string;
  gameCode: string;
  title: string;
  hostPlayerId: string;
  status: FriendlyWordsGame['status'];
  createdAt: string;
  completedAt: string | null;
  language: FriendlyWordsLanguage;
  players: PublicPlayer[];
  waitlist: PublicPlayer[];
  turnOrder: string[];
  currentPlayerIndex: number;
  turnNumber: number;
  tilePoolCount: number;
  board: FriendlyWordsGameState['board'];
  gamePhase: FriendlyWordsGameState['gamePhase'];
  confirmation: FriendlyWordsConfirmation | null;
  livePlay?: FriendlyWordsLivePlay | null;
  winnerPlayerId: string | null | undefined;
  turns: FriendlyWordsTurn[];
  playedWords: FriendlyWordsPlayedWord[];
  myRack?: FriendlyWordsGameState['tilePool'];
  me?: PublicPlayer & { token?: string };
};

type BroadcastFn = (gameId: string, event: string, payload: unknown, excludePlayerId?: string) => void;
type SendToPlayerFn = (gameId: string, playerId: string, event: string, payload: unknown) => void;

const emptyBoard = (): FriendlyWordsGameState['board'] =>
  Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null));

const toPublicPlayer = (player: FriendlyWordsPlayer): PublicPlayer => ({
  id: player.id,
  name: player.name,
  ready: player.ready,
  score: player.score,
  slot: player.slot,
  rackCount: player.rack.length,
});

export class GameManager {
  private dao = new CruziDao();
  private cache = new Map<string, FriendlyWordsGame>();
  /** Ephemeral turn previews — not persisted. */
  private livePlays = new Map<string, FriendlyWordsLivePlay>();
  private broadcast: BroadcastFn = () => undefined;
  private sendToPlayer: SendToPlayerFn = () => undefined;

  setBroadcasters(broadcast: BroadcastFn, sendToPlayer: SendToPlayerFn) {
    this.broadcast = broadcast;
    this.sendToPlayer = sendToPlayer;
  }

  private async loadGame(gameId: string): Promise<FriendlyWordsGame> {
    const cached = this.cache.get(gameId);
    if (cached) return cached;
    const game = await this.dao.getFriendlyWordsGame(gameId);
    if (!game) throw new GameError('Game not found', 404);
    this.cache.set(gameId, game);
    return game;
  }

  private async persist(game: FriendlyWordsGame): Promise<FriendlyWordsGame> {
    const seated = [...game.state.players].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
    const updated = await this.dao.updateFriendlyWordsGame({
      id: game.id,
      title: game.title,
      hostPlayerId: game.hostPlayerId,
      status: game.status,
      player1: seated.find((p) => p.slot === 1)?.name ?? null,
      player2: seated.find((p) => p.slot === 2)?.name ?? null,
      player3: seated.find((p) => p.slot === 3)?.name ?? null,
      player4: seated.find((p) => p.slot === 4)?.name ?? null,
      waitlist: game.state.waitlist,
      state: game.state,
      completedAt: game.completedAt,
    });
    const merged: FriendlyWordsGame = {
      ...updated,
      state: game.state,
      turns: game.turns,
      playedWords: game.playedWords,
    };
    this.cache.set(game.id, merged);
    return merged;
  }

  private requirePlayer(game: FriendlyWordsGame, playerId: string, token?: string): FriendlyWordsPlayer {
    const player =
      game.state.players.find((p) => p.id === playerId) ||
      game.state.waitlist.find((p) => p.id === playerId);
    if (!player) throw new GameError('Player not in game', 403);
    if (token != null && player.token !== token) throw new GameError('Invalid player token', 403);
    return player;
  }

  private requireAuthedPlayer(
    game: FriendlyWordsGame,
    playerId: string,
    token: string
  ): FriendlyWordsPlayer {
    return this.requirePlayer(game, playerId, token);
  }

  private requireHost(game: FriendlyWordsGame, playerId: string) {
    if (game.hostPlayerId !== playerId) throw new GameError('Only the host can do that', 403);
  }

  private requireSeated(game: FriendlyWordsGame, playerId: string): FriendlyWordsPlayer {
    const player = game.state.players.find((p) => p.id === playerId);
    if (!player || player.slot == null) throw new GameError('Player is not seated', 403);
    return player;
  }

  private gameLanguage(game: FriendlyWordsGame): FriendlyWordsLanguage {
    return normalizeLanguage(game.lang);
  }

  toPublicView(game: FriendlyWordsGame, viewerPlayerId?: string): PublicGameView {
    const view: PublicGameView = {
      id: game.id,
      gameCode: game.gameCode,
      title: game.title,
      hostPlayerId: game.hostPlayerId,
      status: game.status,
      createdAt: game.createdAt.toISOString(),
      completedAt: game.completedAt ? game.completedAt.toISOString() : null,
      language: this.gameLanguage(game),
      players: game.state.players.map(toPublicPlayer),
      waitlist: game.state.waitlist.map(toPublicPlayer),
      turnOrder: game.state.turnOrder,
      currentPlayerIndex: game.state.currentPlayerIndex,
      turnNumber: game.state.turnNumber,
      tilePoolCount: game.state.tilePool.length,
      board: game.state.board,
      gamePhase: game.state.gamePhase,
      confirmation: game.state.confirmation,
      livePlay: this.livePlays.get(game.id) ?? null,
      winnerPlayerId: game.state.winnerPlayerId,
      turns: game.turns ?? [],
      playedWords: game.playedWords ?? [],
    };

    if (viewerPlayerId) {
      const me =
        game.state.players.find((p) => p.id === viewerPlayerId) ||
        game.state.waitlist.find((p) => p.id === viewerPlayerId);
      if (me) {
        view.me = toPublicPlayer(me);
        if (me.slot != null) {
          view.myRack = me.rack;
        }
      }
    }

    return view;
  }

  private emitGame(game: FriendlyWordsGame, event = 'game:state') {
    for (const player of [...game.state.players, ...game.state.waitlist]) {
      this.sendToPlayer(game.id, player.id, event, this.toPublicView(game, player.id));
    }
  }

  private emitRejected(game: FriendlyWordsGame, message: string) {
    for (const player of [...game.state.players, ...game.state.waitlist]) {
      this.sendToPlayer(game.id, player.id, 'confirm:rejected', {
        message,
        game: this.toPublicView(game, player.id),
      });
    }
  }

  async createGame(
    languageInput?: string | null
  ): Promise<{ game: PublicGameView; playerId: string; playerToken: string }> {
    const language = normalizeLanguage(languageInput);
    let gameCode = generateGameCode();
    for (let attempt = 0; attempt < 20; attempt++) {
      const existing = await this.dao.getFriendlyWordsGameByCode(gameCode);
      if (!existing) break;
      gameCode = generateGameCode();
    }

    const playerId = generatePlayerId();
    const playerToken = generatePlayerToken();
    const id = generateGameId();
    const host: FriendlyWordsPlayer = {
      id: playerId,
      token: playerToken,
      name: language === 'es' ? 'Jugador 1' : 'Player 1',
      ready: false,
      score: 0,
      rack: [],
      slot: 1,
    };

    const state: FriendlyWordsGameState = {
      players: [host],
      waitlist: [],
      turnOrder: [],
      currentPlayerIndex: 0,
      turnNumber: 0,
      tilePool: [],
      board: emptyBoard(),
      gamePhase: 'ready',
      confirmation: null,
      winnerPlayerId: null,
    };

    const game = await this.dao.createFriendlyWordsGame({
      id,
      gameCode,
      title: language === 'es' ? `Partida ${gameCode}` : `Game ${gameCode}`,
      hostPlayerId: playerId,
      player1: host.name,
      lang: language,
      state,
    });

    this.cache.set(game.id, game);
    const view = this.toPublicView(game, playerId);
    view.me = { ...toPublicPlayer(host), token: playerToken };
    view.myRack = [];
    return { game: view, playerId, playerToken };
  }

  async joinGame(
    gameCode: string
  ): Promise<{ game: PublicGameView; playerId: string; playerToken: string }> {
    const found = await this.dao.getFriendlyWordsGameByCode(gameCode);
    if (!found) throw new GameError('Game not found', 404);
    if (found.status === 'completed') throw new GameError('Game is already completed', 400);

    const game = await this.loadGame(found.id);
    const language = this.gameLanguage(game);
    const playerId = generatePlayerId();
    const playerToken = generatePlayerToken();

    // Joining an in-progress game places the player in Guest mode on the
    // waitlist: they can watch the board and live plays but cannot take turns,
    // propose, rate, or confirm. Seats are not filled mid-game because
    // turnOrder and racks are fixed at startGame.
    const joinAsGuest = game.status === 'playing';
    const openSlot = joinAsGuest
      ? null
      : [1, 2, 3, 4].find(
        (slot) => !game.state.players.some((player) => player.slot === slot)
      );

    const player: FriendlyWordsPlayer = {
      id: playerId,
      token: playerToken,
      name: joinAsGuest
        ? language === 'es'
          ? `Invitado ${game.state.waitlist.length + 1}`
          : `Guest ${game.state.waitlist.length + 1}`
        : openSlot
          ? language === 'es'
            ? `Jugador ${openSlot}`
            : `Player ${openSlot}`
          : language === 'es'
            ? `Espera ${game.state.waitlist.length + 1}`
            : `Waitlist ${game.state.waitlist.length + 1}`,
      ready: false,
      score: 0,
      rack: [],
      slot: openSlot ?? null,
    };

    if (openSlot) {
      game.state.players.push(player);
    } else {
      game.state.waitlist.push(player);
    }

    await this.persist(game);
    this.emitGame(game, 'lobby:updated');
    const view = this.toPublicView(game, playerId);
    view.me = { ...toPublicPlayer(player), token: playerToken };
    return { game: view, playerId, playerToken };
  }

  async getGame(gameId: string, playerId?: string): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    return this.toPublicView(game, playerId);
  }

  async assertPlayerToken(gameId: string, playerId: string, token: string): Promise<void> {
    const game = await this.loadGame(gameId);
    this.requireAuthedPlayer(game, playerId, token);
  }

  async getGameByCode(gameCode: string): Promise<PublicGameView> {
    const found = await this.dao.getFriendlyWordsGameByCode(gameCode);
    if (!found) throw new GameError('Game not found', 404);
    const game = await this.loadGame(found.id);
    return this.toPublicView(game);
  }

  async updateTitle(
    gameId: string,
    playerId: string,
    title: string,
    token?: string
  ): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    if (token) this.requireAuthedPlayer(game, playerId, token);
    this.requireHost(game, playerId);
    if (!title.trim()) throw new GameError('Title cannot be empty');
    game.title = title.trim();
    await this.persist(game);
    this.emitGame(game, 'lobby:updated');
    return this.toPublicView(game, playerId);
  }

  async updatePlayerName(
    gameId: string,
    playerId: string,
    name: string,
    token?: string
  ): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    const player = token
      ? this.requireAuthedPlayer(game, playerId, token)
      : this.requirePlayer(game, playerId);
    if (!name.trim()) throw new GameError('Name cannot be empty');
    player.name = name.trim();
    await this.persist(game);
    this.emitGame(game, 'lobby:updated');
    return this.toPublicView(game, playerId);
  }

  async setReady(gameId: string, playerId: string, ready: boolean): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    if (game.status !== 'lobby') throw new GameError('Game already started');
    const player = this.requireSeated(game, playerId);
    player.ready = ready;
    await this.persist(game);
    this.emitGame(game, 'lobby:updated');
    return this.toPublicView(game, playerId);
  }

  async leaveGame(gameId: string, playerId: string): Promise<PublicGameView | null> {
    const game = await this.loadGame(gameId);
    this.requirePlayer(game, playerId);

    game.state.players = game.state.players.filter((p) => p.id !== playerId);
    game.state.waitlist = game.state.waitlist.filter((p) => p.id !== playerId);

    this.promoteWaitlist(game);

    if (game.hostPlayerId === playerId) {
      const nextHost = game.state.players[0] || game.state.waitlist[0];
      if (nextHost) game.hostPlayerId = nextHost.id;
    }

    if (game.state.players.length === 0 && game.state.waitlist.length === 0) {
      game.status = 'completed';
      game.completedAt = new Date();
      await this.persist(game);
      this.cache.delete(game.id);
      return null;
    }

    await this.persist(game);
    this.emitGame(game, 'lobby:updated');
    return this.toPublicView(game);
  }

  async kickPlayer(gameId: string, hostPlayerId: string, targetPlayerId: string): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    this.requireHost(game, hostPlayerId);
    if (hostPlayerId === targetPlayerId) throw new GameError('Host cannot remove themselves');
    this.requirePlayer(game, targetPlayerId);

    game.state.players = game.state.players.filter((p) => p.id !== targetPlayerId);
    game.state.waitlist = game.state.waitlist.filter((p) => p.id !== targetPlayerId);
    this.promoteWaitlist(game);

    this.sendToPlayer(game.id, targetPlayerId, 'lobby:kicked', {
      message: 'You have been removed from the game.',
    });

    await this.persist(game);
    this.emitGame(game, 'lobby:updated');
    return this.toPublicView(game, hostPlayerId);
  }

  private promoteWaitlist(game: FriendlyWordsGame) {
    while (game.state.players.length < MAX_PLAYERS && game.state.waitlist.length > 0) {
      const next = game.state.waitlist.shift()!;
      const openSlot = [1, 2, 3, 4].find(
        (slot) => !game.state.players.some((player) => player.slot === slot)
      );
      if (!openSlot) break;
      next.slot = openSlot;
      next.name = next.name.startsWith('Waitlist') ? `Player ${openSlot}` : next.name;
      next.ready = false;
      game.state.players.push(next);
    }
  }

  async startGame(gameId: string, hostPlayerId: string): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    this.requireHost(game, hostPlayerId);
    if (game.status !== 'lobby') throw new GameError('Game already started');
    if (game.state.players.length < 2) throw new GameError('Need at least 2 players to start');

    const order = [...game.state.players];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const language = this.gameLanguage(game);
    let pool = createTilePool(language);
    for (const player of order) {
      const drawn = drawTiles(pool, RACK_SIZE);
      player.rack = drawn.tiles;
      player.ready = false;
      player.score = 0;
      pool = drawn.remainingPool;
    }

    game.state.players = order;
    game.state.turnOrder = order.map((p) => p.id);
    game.state.currentPlayerIndex = 0;
    game.state.turnNumber = 1;
    game.state.tilePool = pool;
    game.state.board = emptyBoard();
    game.state.gamePhase = 'playing';
    game.state.confirmation = null;
    game.state.winnerPlayerId = null;
    game.status = 'playing';

    this.clearLivePlay(game.id, false);
    await this.persist(game);
    this.emitGame(game, 'game:started');
    return this.toPublicView(game, hostPlayerId);
  }

  private clearLivePlay(gameId: string, notify = true) {
    if (!this.livePlays.has(gameId)) {
      if (notify) this.broadcast(gameId, 'game:livePlay', null);
      return;
    }
    this.livePlays.delete(gameId);
    if (notify) this.broadcast(gameId, 'game:livePlay', null);
  }

  /**
   * Broadcast the current player's in-progress selection/placements to all clients.
   * Ephemeral — not persisted.
   */
  async updateLivePlay(
    gameId: string,
    playerId: string,
    update: {
      placements?: FriendlyWordsPlacement[];
      selectedSquare?: { row: number; col: number } | null;
      playDirection?: 'across' | 'down';
    }
  ): Promise<FriendlyWordsLivePlay | null> {
    const game = await this.loadGame(gameId);
    if (game.status !== 'playing') throw new GameError('Game is not in progress');
    if (game.state.gamePhase !== 'playing') throw new GameError('Cannot preview during confirmation');

    const currentId = game.state.turnOrder[game.state.currentPlayerIndex];
    if (currentId !== playerId) throw new GameError('Not your turn');

    const player = this.requireSeated(game, playerId);
    const rawPlacements = Array.isArray(update.placements) ? update.placements : [];
    const placements: FriendlyWordsPlacement[] = rawPlacements.map((p) => ({
      row: Number(p.row),
      col: Number(p.col),
      letter: String(p.letter || '').toUpperCase(),
      value: Number(p.value),
      isBlank: Boolean(p.isBlank) || String(p.letter || '') === '',
    }));

    for (const placement of placements) {
      if (
        placement.row < 0 ||
        placement.col < 0 ||
        placement.row >= BOARD_SIZE ||
        placement.col >= BOARD_SIZE
      ) {
        throw new GameError('Placement out of bounds');
      }
      if (game.state.board[placement.row][placement.col]) {
        throw new GameError('Square already occupied');
      }
    }
    if (placements.length > 0) {
      this.assertPlacementsFromRack(player, placements, this.gameLanguage(game));
    }

    let selectedSquare: { row: number; col: number } | null = null;
    if (update.selectedSquare && typeof update.selectedSquare === 'object') {
      const row = Number(update.selectedSquare.row);
      const col = Number(update.selectedSquare.col);
      if (
        Number.isFinite(row) &&
        Number.isFinite(col) &&
        row >= 0 &&
        col >= 0 &&
        row < BOARD_SIZE &&
        col < BOARD_SIZE
      ) {
        selectedSquare = { row, col };
      }
    }

    const playDirection = update.playDirection === 'down' ? 'down' : 'across';

    if (!selectedSquare && placements.length === 0) {
      this.clearLivePlay(gameId, true);
      return null;
    }

    const livePlay: FriendlyWordsLivePlay = {
      playerId,
      placements,
      selectedSquare,
      playDirection,
    };
    this.livePlays.set(gameId, livePlay);
    this.broadcast(gameId, 'game:livePlay', livePlay);
    return livePlay;
  }

  async proposePlay(
    gameId: string,
    playerId: string,
    placements: FriendlyWordsPlacement[]
  ): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    if (game.status !== 'playing') throw new GameError('Game is not in progress');
    if (game.state.gamePhase === 'confirming') throw new GameError('A play is already being confirmed');
    if (game.state.gamePhase === 'gameOver') throw new GameError('Game is over');

    const currentId = game.state.turnOrder[game.state.currentPlayerIndex];
    if (currentId !== playerId) throw new GameError('Not your turn');

    const player = this.requireSeated(game, playerId);
    const language = this.gameLanguage(game);
    this.assertPlacementsFromRack(player, placements, language);

    const geometry = validatePlayGeometry(game.state.board, placements);
    if (!geometry.isValid) throw new GameError(geometry.invalidReason || 'Invalid play');

    const principal = findPrincipalWord(game.state.board, placements, geometry.words);
    const isBingo = placements.length === RACK_SIZE;

    // Spanish games skip the English entry-based recommendation API and default to 1× (Good).
    const recommendations =
      language === 'es'
        ? ({} as Record<string, string>)
        : await this.dao.recommendFriendlyWordsRatings(geometry.words.map((w) => w.entry));

    const words = geometry.words.map((word) => {
      const recommendedRaw = recommendations[word.entry];
      const recommendedLabel =
        language === 'es'
          ? DEFAULT_RATING_LABEL
          : isRatingLabel(recommendedRaw)
            ? recommendedRaw
            : DEFAULT_RATING_LABEL;
      const isPrincipal =
        word.startRow === principal.startRow &&
        word.startCol === principal.startCol &&
        word.direction === principal.direction;
      const grossScore = word.grossScore + (isBingo && isPrincipal ? BINGO_BONUS : 0);
      return {
        id: generateEntityId(),
        entry: word.entry,
        direction: word.direction,
        startRow: word.startRow,
        startCol: word.startCol,
        grossScore,
        recommendedLabel,
        opponentRatings: {},
        ratingLabel: recommendedLabel,
        multiplier: getRatingMultiplier(recommendedLabel),
      };
    });

    const totalMultiplier = productOfMultipliers(words.map((w) => w.multiplier));
    const wordGross = words.reduce((sum, w) => sum + w.grossScore, 0);
    const netScore = Math.round(wordGross * totalMultiplier);

    game.state.confirmation = {
      playerId,
      placements,
      words,
      grossScore: wordGross,
      totalMultiplier,
      netScore,
      confirmedBy: [],
      version: 1,
    };
    game.state.gamePhase = 'confirming';

    this.clearLivePlay(gameId, false);
    await this.persist(game);
    this.emitGame(game, 'confirm:opened');
    return this.toPublicView(game, playerId);
  }

  private assertPlacementsFromRack(
    player: FriendlyWordsPlayer,
    placements: FriendlyWordsPlacement[],
    language: FriendlyWordsLanguage = 'en'
  ) {
    const rackCopy = [...player.rack];
    for (const placement of placements) {
      const isBlank = Boolean(placement.isBlank) || placement.letter === '';
      if (isBlank) {
        if (placement.value !== 0) throw new GameError('Blank tiles must have value 0');
      } else if (placement.value !== getTileValue(placement.letter, language)) {
        throw new GameError('Invalid tile value');
      }

      const idx = rackCopy.findIndex((tile) => {
        if (isBlank) return tile.letter === '' && tile.value === 0;
        return tile.letter === placement.letter.toUpperCase() && tile.value === placement.value;
      });
      if (idx === -1) throw new GameError('Placement uses tiles not on your rack');
      rackCopy.splice(idx, 1);
    }
  }

  private opponentIds(game: FriendlyWordsGame, confirmationPlayerId: string): string[] {
    return game.state.players.map((p) => p.id).filter((id) => id !== confirmationPlayerId);
  }

  async rateWord(
    gameId: string,
    playerId: string,
    wordId: string,
    ratingLabel: string
  ): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    this.requireSeated(game, playerId);
    if (game.state.gamePhase !== 'confirming' || !game.state.confirmation) {
      throw new GameError('No play is awaiting confirmation');
    }
    const confirmation = game.state.confirmation;
    if (confirmation.playerId === playerId) {
      throw new GameError('The player on turn cannot rate words');
    }
    if (!isRatingLabel(ratingLabel)) throw new GameError('Invalid rating');

    const word = confirmation.words.find((w) => w.id === wordId);
    if (!word) throw new GameError('Word not found');

    const label = ratingLabel as FriendlyWordsRatingLabel;
    word.opponentRatings[playerId] = {
      ratingLabel: label,
      wasUpdated: label !== word.recommendedLabel,
    };

    // Changing a rating clears this opponent's confirmation
    confirmation.confirmedBy = confirmation.confirmedBy.filter((id) => id !== playerId);
    recomputeConfirmationConsensus(confirmation);
    confirmation.version += 1;

    await this.persist(game);
    this.emitGame(game, 'confirm:updated');
    return this.toPublicView(game, playerId);
  }

  async confirmPlay(gameId: string, playerId: string): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    this.requireSeated(game, playerId);
    if (game.state.gamePhase !== 'confirming' || !game.state.confirmation) {
      throw new GameError('No play is awaiting confirmation');
    }

    const confirmation = game.state.confirmation;
    if (confirmation.playerId === playerId) {
      throw new GameError('The player on turn does not confirm — opponents do');
    }

    // Ensure this opponent has a rating recorded for every word (defaults to recommended)
    for (const word of confirmation.words) {
      ensureOpponentRating(word, playerId);
    }

    if (!confirmation.confirmedBy.includes(playerId)) {
      confirmation.confirmedBy.push(playerId);
    }

    recomputeConfirmationConsensus(confirmation);
    confirmation.version += 1;

    const opponents = this.opponentIds(game, confirmation.playerId);
    const allOpponentsConfirmed =
      opponents.length === 0 ||
      opponents.every((id) => confirmation.confirmedBy.includes(id));

    if (!allOpponentsConfirmed) {
      await this.persist(game);
      this.emitGame(game, 'confirm:updated');
      return this.toPublicView(game, playerId);
    }

    if (confirmation.netScore <= 0) {
      game.state.confirmation = null;
      game.state.gamePhase = 'playing';
      await this.persist(game);
      this.emitRejected(game, '0 points scored, please try again');
      return this.toPublicView(game, playerId);
    }

    await this.commitConfirmedPlay(game);
    this.emitGame(game, 'confirm:committed');
    if (game.status === 'completed') {
      this.emitGame(game, 'game:over');
    }
    return this.toPublicView(game, playerId);
  }

  async cancelPlay(gameId: string, playerId: string): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    if (game.state.gamePhase !== 'confirming' || !game.state.confirmation) {
      throw new GameError('No play is awaiting confirmation');
    }
    if (game.state.confirmation.playerId !== playerId && game.hostPlayerId !== playerId) {
      throw new GameError('Only the current player or host can cancel');
    }

    game.state.confirmation = null;
    game.state.gamePhase = 'playing';
    await this.persist(game);
    this.emitGame(game, 'confirm:cancelled');
    return this.toPublicView(game, playerId);
  }

  private async commitConfirmedPlay(game: FriendlyWordsGame) {
    const confirmation = game.state.confirmation!;
    const playerIndex = game.state.players.findIndex((p) => p.id === confirmation.playerId);
    if (playerIndex < 0) throw new GameError('Player not found for confirmation');
    const player = game.state.players[playerIndex];
    const startScore = player.score;

    // Rack contents were already validated in proposePlay when the proposer
    // submitted the placements, and no rack-mutating action is permitted while
    // the game is in the 'confirming' phase, so we don't re-assert here — the
    // opponent triggering this commit doesn't own the placements' tiles.
    const rackAtStart = serializeRack(player.rack);
    const action = formatPlayAction(game.state.board, confirmation.placements);

    // Remove used tiles from rack
    for (const placement of confirmation.placements) {
      const isBlank = Boolean(placement.isBlank) || placement.letter === '';
      const idx = player.rack.findIndex((tile) => {
        if (isBlank) return tile.letter === '' && tile.value === 0;
        return tile.letter === placement.letter.toUpperCase() && tile.value === placement.value;
      });
      if (idx >= 0) player.rack.splice(idx, 1);
    }

    game.state.board = applyPlacementsToBoard(
      game.state.board,
      confirmation.placements,
      playerIndex
    );

    player.score += confirmation.netScore;
    const drawn = drawTiles(game.state.tilePool, RACK_SIZE - player.rack.length);
    player.rack.push(...drawn.tiles);
    game.state.tilePool = drawn.remainingPool;

    const turn: FriendlyWordsTurn = {
      id: generateEntityId(),
      gameId: game.id,
      player: player.name,
      turnNumber: game.state.turnNumber,
      rack: rackAtStart,
      action,
      grossScore: confirmation.grossScore,
      totalMultiplier: String(confirmation.totalMultiplier),
      netScore: confirmation.netScore,
      startScore,
      endScore: player.score,
    };

    const lang = this.gameLanguage(game);
    const playedWords: FriendlyWordsPlayedWord[] = confirmation.words.map((word) => ({
      id: word.id,
      turnId: turn.id,
      entry: word.entry,
      lang,
      grossScore: word.grossScore,
      multiplier: String(word.multiplier),
    }));

    await this.dao.submitFriendlyWordsTurn(turn, playedWords);

    const ratings: FriendlyWordsRating[] = [];
    for (const word of confirmation.words) {
      for (const opponentId of confirmation.confirmedBy) {
        const rating = word.opponentRatings[opponentId];
        if (!rating) continue;
        ratings.push({
          playedWordId: word.id,
          playerId: opponentId,
          entry: word.entry,
          lang,
          multiplier: String(getRatingMultiplier(rating.ratingLabel)),
          wasUpdated: rating.wasUpdated,
        });
      }
    }
    await this.dao.addFriendlyWordsRatings(ratings);

    game.turns = [...(game.turns || []), turn];
    game.playedWords = [...(game.playedWords || []), ...playedWords];

    game.state.confirmation = null;
    game.state.turnNumber += 1;

    const shouldEnd =
      (player.rack.length === 0 && game.state.tilePool.length === 0) ||
      game.state.players.every((p) => p.rack.length === 0 && game.state.tilePool.length === 0);

    if (shouldEnd) {
      this.finalizeGame(game);
    } else {
      game.state.currentPlayerIndex =
        (game.state.currentPlayerIndex + 1) % game.state.turnOrder.length;
      game.state.gamePhase = 'playing';
    }

    this.clearLivePlay(game.id, false);
    await this.persist(game);
  }

  async exchangeTiles(
    gameId: string,
    playerId: string,
    tileIndices: number[]
  ): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    if (game.status !== 'playing') throw new GameError('Game is not in progress');
    if (game.state.gamePhase === 'confirming') throw new GameError('Finish confirmation first');

    const currentId = game.state.turnOrder[game.state.currentPlayerIndex];
    if (currentId !== playerId) throw new GameError('Not your turn');
    if (tileIndices.length === 0) throw new GameError('No tiles selected for exchange');
    if (game.state.tilePool.length < tileIndices.length) {
      throw new GameError('Not enough tiles in the bag to exchange');
    }

    const player = this.requireSeated(game, playerId);
    const uniqueIndices = [...new Set(tileIndices)].sort((a, b) => b - a);
    if (uniqueIndices.some((i) => i < 0 || i >= player.rack.length)) {
      throw new GameError('Invalid tile index');
    }

    const startScore = player.score;
    const rackAtStart = serializeRack(player.rack);
    const exchanged = uniqueIndices.map((i) => player.rack[i]);
    const action = formatExchangeAction(exchanged);
    for (const i of uniqueIndices) player.rack.splice(i, 1);

    const drawn = drawTiles(game.state.tilePool, exchanged.length);
    player.rack.push(...drawn.tiles);
    const returnedPool = [...drawn.remainingPool, ...exchanged];
    for (let i = returnedPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [returnedPool[i], returnedPool[j]] = [returnedPool[j], returnedPool[i]];
    }
    game.state.tilePool = returnedPool;

    const turn: FriendlyWordsTurn = {
      id: generateEntityId(),
      gameId: game.id,
      player: player.name,
      turnNumber: game.state.turnNumber,
      rack: rackAtStart,
      action,
      grossScore: 0,
      totalMultiplier: '1',
      netScore: 0,
      startScore,
      endScore: player.score,
    };
    await this.dao.submitFriendlyWordsTurn(turn, []);
    game.turns = [...(game.turns || []), turn];

    game.state.turnNumber += 1;
    game.state.currentPlayerIndex =
      (game.state.currentPlayerIndex + 1) % game.state.turnOrder.length;
    game.state.gamePhase = 'playing';

    this.clearLivePlay(gameId, false);
    await this.persist(game);
    this.emitGame(game, 'game:state');
    return this.toPublicView(game, playerId);
  }

  private finalizeGame(game: FriendlyWordsGame) {
    // Transfer remaining tile values from unfinished racks
    const emptied = game.state.players.find((p) => p.rack.length === 0);
    if (emptied) {
      for (const player of game.state.players) {
        if (player.id === emptied.id) continue;
        const leftover = player.rack.reduce((sum, tile) => sum + tile.value, 0);
        player.score -= leftover;
        emptied.score += leftover;
        player.rack = [];
      }
    }

    let winner = game.state.players[0];
    for (const player of game.state.players) {
      if (player.score > winner.score) winner = player;
    }
    game.state.winnerPlayerId = winner.id;
    game.state.gamePhase = 'gameOver';
    game.status = 'completed';
    game.completedAt = new Date();
  }

  async returnToLobby(gameId: string, playerId: string): Promise<PublicGameView> {
    const game = await this.loadGame(gameId);
    this.requireHost(game, playerId);
    if (game.status === 'completed' || game.state.gamePhase === 'gameOver') {
      throw new GameError('Completed games cannot return to the lobby', 400);
    }

    for (const player of game.state.players) {
      player.ready = false;
      player.score = 0;
      player.rack = [];
    }

    game.status = 'lobby';
    game.completedAt = null;
    game.state.turnOrder = [];
    game.state.currentPlayerIndex = 0;
    game.state.turnNumber = 0;
    game.state.tilePool = [];
    game.state.board = emptyBoard();
    game.state.gamePhase = 'ready';
    game.state.confirmation = null;
    game.state.winnerPlayerId = null;

    this.clearLivePlay(gameId, false);
    await this.persist(game);
    this.emitGame(game, 'lobby:updated');
    return this.toPublicView(game, playerId);
  }
}

export const gameManager = new GameManager();
