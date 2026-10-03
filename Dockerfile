FROM node:22-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
RUN useradd --create-home --uid 1000 wortlauf && mkdir /data && chown wortlauf /data
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/app backend/app
COPY plugins plugins
COPY --from=web /src/frontend/dist frontend/dist
ENV WORTLAUF_DATA=/data
USER wortlauf
VOLUME /data
EXPOSE 8000
WORKDIR /app/backend
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
