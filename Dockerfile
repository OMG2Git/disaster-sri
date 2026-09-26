FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# tsx runs the TypeScript directly (fine for a take-home; a production image would `tsc` to dist/).
# The command is chosen per service in docker-compose.yml.
CMD ["npm", "run", "start:api"]
