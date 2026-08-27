#!/bin/sh

# Default unRaid UID and GID (nobody:users)
USER_ID=${PUID:-99}
GROUP_ID=${PGID:-100}

echo "[INFO] Mapping container user 'node' to Host PUID=${USER_ID} and PGID=${GROUP_ID}..."

# Modify node group GID to match PGID
if [ $(getent group node | cut -d: -f3) -ne $GROUP_ID ]; then
    groupmod -o -g $GROUP_ID node
fi

# Modify node user UID to match PUID
if [ $(id -u node) -ne $USER_ID ]; then
    usermod -o -u $USER_ID node
fi

# Ensure data directory and cache directory exist
mkdir -p /app/data/cache

# Change ownership of app data to the mapped user
chown -R node:node /app/data

# Start Node.js backend directly on port 3000 as 'node'
echo "[INFO] Starting Reddit Gallery server as node user..."
exec su-exec node:node node server.js
