# Jarvis HUD: holographic voice interface for Jarvis OS (no dependencies).
FROM node:22-slim
WORKDIR /app
COPY server.js models.json ./
COPY public ./public
ENV PORT=3001 DATA_DIR=/data PERSONA_PATH=/app/persona.md
EXPOSE 3001
CMD ["node", "server.js"]
