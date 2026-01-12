FROM node:25-slim

# Install latest chrome dev package and fonts to support major charsets (Chinese, Japanese, Arabic, Hebrew, Thai and a few others)
# Note: this installs the necessary libs to make the bundled version of Chromium that Puppeteer
# installs, work.
RUN apt-get update \
    && apt-get install -y wget gnupg make \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y libxshmfence1 libglu1 google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Add user so we don't need --no-sandbox.
# same layer as npm install to keep re-chowned files from using up several hundred MBs more space
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && mkdir -p /home/pptruser/app \
    && mkdir -p /home/pptruser/config \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /home/pptruser/app \
    && chown -R pptruser:pptruser /home/pptruser/config

# Run everything after as non-privileged user.
USER pptruser

WORKDIR /home/pptruser/app


COPY --chown=pptruser:pptruser ["Makefile", "package.json", "package-lock.json*", "tsconfig.json", "./"]
COPY --chown=pptruser:pptruser israeli-bank-scrapers ./israeli-bank-scrapers

RUN make patch-scrapers
# the rest of your dockerfile here
COPY --chown=pptruser:pptruser . .

RUN make build
RUN make remove-dev-deps

CMD ["npm", "start"]