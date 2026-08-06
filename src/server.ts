import cors from 'cors';
import express from 'express';
import BaseRouter from './routes';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        /^http:\/\/localhost:\d+$/.test(origin) ||
        /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
        origin === 'https://friendlywords.com' || 
        origin === 'https://cruzi.net'
      ) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  })
);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(['/api', '/friendly-words/api'], BaseRouter);

export default app;
