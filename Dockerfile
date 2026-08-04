# syntax=docker/dockerfile:1.4

FROM node:20-alpine AS builder

WORKDIR /workspace/cruzi-models
COPY --from=cruzi-models package*.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY --from=cruzi-models src ./src
RUN npm run build

WORKDIR /workspace/cruzi-db
COPY --from=cruzi-db package*.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY --from=cruzi-db src ./src
RUN npm run build

WORKDIR /workspace/friendly-words-api
COPY package*.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM node:20-alpine

WORKDIR /workspace/friendly-words-api
ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /workspace/cruzi-models /workspace/cruzi-models
COPY --from=builder /workspace/cruzi-db /workspace/cruzi-db
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /workspace/friendly-words-api/dist ./dist

EXPOSE 3001

CMD ["node", "dist/index.js"]
