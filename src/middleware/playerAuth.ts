import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';

export type PlayerRequest = Request & {
  playerId?: string;
  playerToken?: string;
};

export function attachPlayerIdentity(req: PlayerRequest, _res: Response, next: NextFunction) {
  const playerId =
    (req.header('x-player-id') as string | undefined) ||
    (req.body?.playerId as string | undefined) ||
    (req.query.playerId as string | undefined);
  const playerToken =
    (req.header('x-player-token') as string | undefined) ||
    (req.body?.playerToken as string | undefined) ||
    (req.query.playerToken as string | undefined);

  req.playerId = playerId;
  req.playerToken = playerToken;
  next();
}

export function requirePlayer(req: PlayerRequest, res: Response, next: NextFunction) {
  if (!req.playerId || !req.playerToken) {
    return res.status(StatusCodes.UNAUTHORIZED).json({
      message: 'Missing player identity. Provide X-Player-Id and X-Player-Token headers.',
    });
  }
  next();
}
