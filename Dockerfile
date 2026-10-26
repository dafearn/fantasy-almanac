FROM node:22-slim
WORKDIR /app
COPY . .
ENV PORT=8000 DATA_DIR=/data COOKIE_SECURE=1
EXPOSE 8000
VOLUME ["/data"]
CMD ["node", "--no-warnings", "server/server.mjs"]
