const CHAR_POOL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';

function randomFromPool(length: number): string {
  let value = '';
  for (let i = 0; i < length; i++) {
    value += CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)];
  }
  return value;
}

export function generateGameId(): string {
  return randomFromPool(11);
}

export function generatePlayerId(): string {
  return randomFromPool(11);
}

export function generatePlayerToken(): string {
  return randomFromPool(22);
}

export function generateGameCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function generateEntityId(): string {
  return randomFromPool(11);
}
