FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
COPY scripts ./scripts
COPY migrations ./migrations
EXPOSE 3000
CMD ["node", "server.js"]
