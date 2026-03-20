FROM node:22-alpine

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install

COPY src ./src
COPY migrations ./migrations

ENV NODE_ENV=production

RUN npm run build

CMD ["sh", "-c", "npm run migrate && node dist/index.js"]
