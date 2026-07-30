import { Router } from 'express';
import {
  cancelPlay,
  confirmPlay,
  createGame,
  exchangeTiles,
  getGame,
  getGameByCode,
  joinGame,
  kickPlayer,
  leaveGame,
  proposePlay,
  rateWord,
  returnToLobby,
  setReady,
  startGame,
  updatePlayerName,
  updateTitle,
} from '../handlers/games';
import { attachPlayerIdentity, requirePlayer } from '../middleware/playerAuth';

const apiRouter = Router();

apiRouter.use(attachPlayerIdentity);

apiRouter.post('/games', createGame);
apiRouter.post('/games/join', joinGame);
apiRouter.get('/games/by-code/:code', getGameByCode);
apiRouter.get('/games/:id', getGame);

apiRouter.patch('/games/:id', requirePlayer, updateTitle);
apiRouter.patch('/games/:id/players/me', requirePlayer, updatePlayerName);
apiRouter.post('/games/:id/players/me/ready', requirePlayer, setReady);
apiRouter.post('/games/:id/leave', requirePlayer, leaveGame);
apiRouter.delete('/games/:id/players/:playerId', requirePlayer, kickPlayer);
apiRouter.post('/games/:id/start', requirePlayer, startGame);

apiRouter.post('/games/:id/turns/propose', requirePlayer, proposePlay);
apiRouter.post('/games/:id/turns/exchange', requirePlayer, exchangeTiles);
apiRouter.post('/games/:id/confirmation/rate', requirePlayer, rateWord);
apiRouter.post('/games/:id/confirmation/confirm', requirePlayer, confirmPlay);
apiRouter.post('/games/:id/confirmation/cancel', requirePlayer, cancelPlay);
apiRouter.post('/games/:id/return-to-lobby', requirePlayer, returnToLobby);

export default apiRouter;
