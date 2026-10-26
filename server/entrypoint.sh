#!/bin/sh
set -e
cd /pb

# Applies pending migrations (collections, access rules) on every start.
./pocketbase migrate up --dir=/pb/pb_data --migrationsDir=/pb/pb_migrations

# Creates or updates the dashboard superuser from .env, if given.
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  ./pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir=/pb/pb_data
fi

exec ./pocketbase serve --http=0.0.0.0:8090 --dir=/pb/pb_data \
  --migrationsDir=/pb/pb_migrations --publicDir=/pb/pb_public
