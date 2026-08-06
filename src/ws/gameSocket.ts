import { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { gameManager, GameError } from '../game/GameManager';

type ClientMessage = {
  type: string;
  gameId?: string;
  playerId?: string;
  playerToken?: string;
  payload?: Record<string, unknown>;
};

type SocketClient = WebSocket & {
  playerId?: string;
  playerToken?: string;
  gameId?: string;
};

type RoomClient = {
  ws: SocketClient;
  playerId: string;
};

const rooms = new Map<string, Set<RoomClient>>();

function send(ws: WebSocket, type: string, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function addToRoom(gameId: string, playerId: string, ws: SocketClient) {
  if (!rooms.has(gameId)) rooms.set(gameId, new Set());
  const room = rooms.get(gameId)!;
  for (const client of [...room]) {
    if (client.playerId === playerId) {
      room.delete(client);
    }
  }
  room.add({ ws, playerId });
  ws.gameId = gameId;
  ws.playerId = playerId;
}

function removeSocket(ws: SocketClient) {
  if (!ws.gameId) return;
  const room = rooms.get(ws.gameId);
  if (!room) return;
  for (const client of [...room]) {
    if (client.ws === ws) room.delete(client);
  }
  if (room.size === 0) rooms.delete(ws.gameId);
}

export function broadcast(gameId: string, event: string, payload: unknown, excludePlayerId?: string) {
  const room = rooms.get(gameId);
  if (!room) return;
  for (const client of room) {
    if (excludePlayerId && client.playerId === excludePlayerId) continue;
    send(client.ws, event, payload);
  }
}

export function sendToPlayer(gameId: string, playerId: string, event: string, payload: unknown) {
  const room = rooms.get(gameId);
  if (!room) return;
  for (const client of room) {
    if (client.playerId === playerId) {
      send(client.ws, event, payload);
    }
  }
}

async function handleMessage(ws: SocketClient, raw: string) {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw);
  } catch {
    send(ws, 'error', { message: 'Invalid JSON message' });
    return;
  }

  const { type, gameId, playerId, playerToken, payload = {} } = message;

  try {
    if (type === 'lobby:join' || type === 'subscribe') {
      if (!gameId || !playerId || !playerToken) {
        throw new GameError('gameId, playerId, and playerToken are required', 400);
      }
      const game = await gameManager.getGame(gameId, playerId);
      if (!game.me) throw new GameError('Player not in game', 403);
      // Validate token against live state
      await gameManager.assertPlayerToken(gameId, playerId, playerToken);
      addToRoom(gameId, playerId, ws);
      ws.playerToken = playerToken;
      send(ws, 'game:state', game);
      return;
    }

    if (!ws.gameId || !ws.playerId) {
      throw new GameError('Subscribe to a game first via lobby:join', 400);
    }

    const id = ws.gameId;
    const pid = ws.playerId;

    switch (type) {
      case 'lobby:setName':
        send(ws, 'lobby:updated', await gameManager.updatePlayerName(id, pid, String(payload.name || '')));
        break;
      case 'lobby:setReady':
        send(ws, 'lobby:updated', await gameManager.setReady(id, pid, Boolean(payload.ready)));
        break;
      case 'lobby:setTitle':
        send(ws, 'lobby:updated', await gameManager.updateTitle(id, pid, String(payload.title || '')));
        break;
      case 'lobby:kick':
        send(ws, 'lobby:updated', await gameManager.kickPlayer(id, pid, String(payload.playerId || '')));
        break;
      case 'lobby:leave':
        await gameManager.leaveGame(id, pid);
        send(ws, 'lobby:left', { ok: true });
        removeSocket(ws);
        break;
      case 'lobby:start':
        send(ws, 'game:started', await gameManager.startGame(id, pid));
        break;
      case 'game:proposePlay': {
        const placements = Array.isArray(payload.placements) ? payload.placements : [];
        const normalized = placements.map((p: any) => ({
          row: Number(p.row),
          col: Number(p.col),
          letter: String(p.letter || '').toUpperCase(),
          value: Number(p.value),
          isBlank: Boolean(p.isBlank) || String(p.letter || '') === '',
        }));
        send(ws, 'confirm:opened', await gameManager.proposePlay(id, pid, normalized));
        break;
      }
      case 'game:livePlay': {
        const selected =
          payload.selectedSquare && typeof payload.selectedSquare === 'object'
            ? (payload.selectedSquare as { row: number; col: number })
            : null;
        await gameManager.updateLivePlay(id, pid, {
          placements: Array.isArray(payload.placements) ? (payload.placements as any[]) : [],
          selectedSquare: selected,
          playDirection: payload.playDirection === 'down' ? 'down' : 'across',
        });
        break;
      }
      case 'game:exchange':
        send(
          ws,
          'game:state',
          await gameManager.exchangeTiles(
            id,
            pid,
            Array.isArray(payload.tileIndices) ? payload.tileIndices.map((n: unknown) => Number(n)) : []
          )
        );
        break;
      case 'confirm:rate':
        send(
          ws,
          'confirm:updated',
          await gameManager.rateWord(id, pid, String(payload.wordId || ''), String(payload.ratingLabel || ''))
        );
        break;
      case 'confirm:confirm':
        send(ws, 'confirm:updated', await gameManager.confirmPlay(id, pid));
        break;
      case 'confirm:cancel':
        send(ws, 'confirm:cancelled', await gameManager.cancelPlay(id, pid));
        break;
      case 'game:returnToLobby':
        send(ws, 'lobby:updated', await gameManager.returnToLobby(id, pid));
        break;
      default:
        send(ws, 'error', { message: `Unknown message type: ${type}` });
    }
  } catch (error) {
    const messageText = error instanceof GameError ? error.message : 'WebSocket action failed';
    if (!(error instanceof GameError)) console.error(messageText, error);
    send(ws, 'error', { message: messageText });
  }
}

const WS_PATHS = new Set(['/ws', '/friendly-words/ws']);

function connectionHandler(ws: SocketClient, _req: IncomingMessage) {
  send(ws, 'connected', { ok: true });

  ws.on('message', (data) => {
    void handleMessage(ws, data.toString());
  });

  ws.on('close', () => {
    removeSocket(ws);
  });
}

export function attachGameWebSocket(server: HttpServer) {
  // Use a single WebSocketServer in noServer mode and route upgrade requests
  // by path ourselves. Attaching multiple WebSocketServer instances to the
  // same http.Server breaks connections: each registers its own 'upgrade'
  // listener, and the instance whose path doesn't match calls abortHandshake()
  // on a socket the other instance may have already upgraded, destroying it.
  const wss = new WebSocketServer({ noServer: true });

  gameManager.setBroadcasters(broadcast, sendToPlayer);

  server.on('upgrade', (req, socket, head) => {
    const pathname = req.url ? req.url.split('?')[0] : '';
    if (!WS_PATHS.has(pathname)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      connectionHandler(ws as SocketClient, req);
    });
  });
}
