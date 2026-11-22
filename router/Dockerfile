# Free Claude Code (FCC) router in a container.
# Source: https://github.com/Alishahryar1/free-claude-code (AGPL-3.0)
# Lets Claude Code, Codex, Cline, Aider, etc. use free/local/other models.
FROM debian:bookworm-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Version from PyPI. To update: change the number, then `docker compose build router`.
ARG FCC_VERSION=6.19.46
RUN uv tool install --python 3.14.10 "free-claude-code==${FCC_VERSION}"
ENV PATH="/root/.local/bin:${PATH}" HOST=0.0.0.0 PORT=8082
EXPOSE 8082
CMD ["fcc-server"]
