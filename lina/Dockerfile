# Lina checker for Jarvis OS: the Lina Sigra engine as a tiny web service (Python standard library only).
FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
COPY engine ./engine
ENV PORT=8090 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8090
CMD ["python", "server.py"]
