import { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { gameManager } from '../game/GameManager';
import { handleGameError } from '../lib/errors';
import { PlayerRequest } from '../middleware/playerAuth';

function param(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

export async function createGame(req: PlayerRequest, res: Response) {
  try {
    const language = typeof req.body?.language === 'string' ? req.body.language : 'en';
    const result = await gameManager.createGame(language);
    return res.status(StatusCodes.CREATED).json(result);
  } catch (error) {
    return handleGameError(res, error, 'Failed to create game');
  }
}

export async function joinGame(req: PlayerRequest, res: Response) {
  try {
    const code = String(req.body?.gameCode || param(req.params.code || '')).trim();
    if (!/^\d{4}$/.test(code)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Game code must be 4 digits' });
    }
    const result = await gameManager.joinGame(code);
    return res.status(StatusCodes.OK).json(result);
  } catch (error) {
    return handleGameError(res, error, 'Failed to join game');
  }
}

export async function getGame(req: PlayerRequest, res: Response) {
  try {
    const game = await gameManager.getGame(param(req.params.id), req.playerId);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to get game');
  }
}

export async function getGameByCode(req: PlayerRequest, res: Response) {
  try {
    const code = String(param(req.params.code) || '').trim();
    if (!/^\d{4}$/.test(code)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Game code must be 4 digits' });
    }
    const game = await gameManager.getGameByCode(code);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to get game');
  }
}

export async function updateTitle(req: PlayerRequest, res: Response) {
  try {
    const game = await gameManager.updateTitle(
      param(req.params.id),
      req.playerId!,
      String(req.body?.title || '')
    );
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to update title');
  }
}

export async function updatePlayerName(req: PlayerRequest, res: Response) {
  try {
    const game = await gameManager.updatePlayerName(
      param(req.params.id),
      req.playerId!,
      String(req.body?.name || '')
    );
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to update player name');
  }
}

export async function setReady(req: PlayerRequest, res: Response) {
  try {
    const ready = Boolean(req.body?.ready);
    const game = await gameManager.setReady(param(req.params.id), req.playerId!, ready);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to update ready status');
  }
}

export async function leaveGame(req: PlayerRequest, res: Response) {
  try {
    const game = await gameManager.leaveGame(param(req.params.id), req.playerId!);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to leave game');
  }
}

export async function kickPlayer(req: PlayerRequest, res: Response) {
  try {
    const targetPlayerId = String(param(req.params.playerId) || req.body?.playerId || '');
    const game = await gameManager.kickPlayer(param(req.params.id), req.playerId!, targetPlayerId);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to remove player');
  }
}

export async function startGame(req: PlayerRequest, res: Response) {
  try {
    const game = await gameManager.startGame(param(req.params.id), req.playerId!);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to start game');
  }
}

export async function proposePlay(req: PlayerRequest, res: Response) {
  try {
    const placements = Array.isArray(req.body?.placements) ? req.body.placements : [];
    const normalized = placements.map((p: any) => ({
      row: Number(p.row),
      col: Number(p.col),
      letter: String(p.letter || '').toUpperCase(),
      value: Number(p.value),
      isBlank: Boolean(p.isBlank) || String(p.letter || '') === '',
    }));
    const game = await gameManager.proposePlay(param(req.params.id), req.playerId!, normalized);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to propose play');
  }
}

export async function exchangeTiles(req: PlayerRequest, res: Response) {
  try {
    const tileIndices = Array.isArray(req.body?.tileIndices)
      ? req.body.tileIndices.map((n: unknown) => Number(n))
      : [];
    const game = await gameManager.exchangeTiles(param(req.params.id), req.playerId!, tileIndices);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to exchange tiles');
  }
}

export async function rateWord(req: PlayerRequest, res: Response) {
  try {
    const game = await gameManager.rateWord(
      param(req.params.id),
      req.playerId!,
      String(req.body?.wordId || ''),
      String(req.body?.ratingLabel || '')
    );
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to rate word');
  }
}

export async function confirmPlay(req: PlayerRequest, res: Response) {
  try {
    const game = await gameManager.confirmPlay(param(req.params.id), req.playerId!);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to confirm play');
  }
}

export async function cancelPlay(req: PlayerRequest, res: Response) {
  try {
    const game = await gameManager.cancelPlay(param(req.params.id), req.playerId!);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to cancel play');
  }
}

export async function returnToLobby(req: PlayerRequest, res: Response) {
  try {
    const game = await gameManager.returnToLobby(param(req.params.id), req.playerId!);
    return res.status(StatusCodes.OK).json({ game });
  } catch (error) {
    return handleGameError(res, error, 'Failed to return to lobby');
  }
}
