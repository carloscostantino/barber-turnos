FROM node:22-alpine

WORKDIR /app

COPY package*.json tsconfig*.json vite.config.* ./
RUN npm install

COPY index.html ./
COPY src ./src

ENV NODE_ENV=development
ENV VITE_API_BASE=http://localhost:3001/api

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
