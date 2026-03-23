FROM node:20-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --retries=5 CMD curl -f http://localhost:4000/health || exit 1
CMD ["node", "index.js"]