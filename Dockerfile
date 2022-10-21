# reference https://developers.google.com/web/tools/puppeteer/troubleshooting#setting_up_chrome_linux_sandbox
FROM node:current-alpine

# manually installing chrome
RUN apk add chromium

# skips puppeteer installing chrome and points to correct binary
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app
COPY ["package.json", "package-lock.json*", "./"]
RUN npm ci
# the rest of your dockerfile here
COPY . .

ENV IBFI_CONFIG_PATH='/config'

CMD ["npm", "start"]