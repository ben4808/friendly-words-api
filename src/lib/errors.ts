import { Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { GameError } from '../game/GameManager';

export function handleGameError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof GameError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  console.error(fallbackMessage, error);
  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: fallbackMessage });
}
