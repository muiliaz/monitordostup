# Node >= 22.18 runs .ts files directly (type stripping), so no build step.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
EXPOSE 4000
CMD ["node", "src/index.ts"]
