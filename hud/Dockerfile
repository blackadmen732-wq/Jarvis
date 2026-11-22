# Jarvis HUD: holographic voice interface for Jarvis OS (no dependencies).
# Built from the project folder so it can include Jarvis Hands' locked-command list (hands/hands.js).
FROM node:22-slim
WORKDIR /app
COPY hud/server.js hud/models.json ./
COPY hud/public ./public
COPY hands/hands.js ./hands.js
ENV PORT=3001 DATA_DIR=/data PERSONA_PATH=/app/persona.md GROK_PERSONA_PATH=/app/persona-grok.md
EXPOSE 3001
CMD ["node", "server.js"]
