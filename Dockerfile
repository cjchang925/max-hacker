FROM node:latest

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY src/ ./src/

COPY .env ./

COPY tsconfig.json ./

RUN npx tsc

CMD ["npx", "ts-node", "src/index.ts"]
