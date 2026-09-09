# Immagine per gli host che preferiscono un container (Fly.io, Railway, ecc.)
FROM node:22-slim

WORKDIR /app

# Le dipendenze si copiano prima del codice: così la cache si invalida
# solo quando cambiano davvero, e i deploy restano veloci.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV SOLVIA_DATA_DIR=/data

EXPOSE 3000
CMD ["node", "server.js"]
