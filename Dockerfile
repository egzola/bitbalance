FROM node:20-alpine

WORKDIR /app

# evita reinstall desnecessário
COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

# cria usuário não-root (alinha com Umbrel)
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3710

# healthcheck leve
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3710/health || exit 1

CMD ["node", "server.js"]