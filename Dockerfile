FROM node:22-alpine AS build
WORKDIR /app
# .git is not in the build context, so skip the husky prepare script
# (yarn runs `husky install` on install, which errors outside a git repo).
ENV HUSKY=0
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
