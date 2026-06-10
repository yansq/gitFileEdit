FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache git
COPY package.json tsconfig.base.json vite.config.ts index.html ./
COPY client ./client
COPY server ./server
COPY data ./data
RUN npm install
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache git
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
ENV PORT=8090
EXPOSE 8090
CMD ["node", "dist/server/index.js"]
