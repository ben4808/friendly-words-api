import 'dotenv/config';
import http from 'http';
import app from './server';
import { attachGameWebSocket } from './ws/gameSocket';

const port = Number(process.env.PORT || 3001);
const server = http.createServer(app);

attachGameWebSocket(server);

server.listen(port, () => {
  console.log(`Friendly Words API listening on port ${port}`);
  console.log(`WebSocket endpoint: ${process.env.WS_URL || `ws://localhost:${port}/ws`}`);
});
