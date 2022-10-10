#!/bin/sh
cp /config/local.yaml /app/config/local.yaml
exec "$@"
