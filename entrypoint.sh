#!/bin/sh

# Default Cache Limit to 2 GB if not specified
CACHE_LIMIT=${CACHE_LIMIT_GB:-2}
echo "[INFO] Configuring Nginx cache limit to ${CACHE_LIMIT} GB"
sed -i "s/CACHE_LIMIT_PLACEHOLDER/${CACHE_LIMIT}/g" /etc/nginx/nginx.conf

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
chown -R node:node /var/lib/nginx
chown -R node:node /var/log/nginx
chown -R node:node /tmp

# Start Node.js backend on port 3031 and Nginx frontend proxy on port 3000 as 'node'
echo "[INFO] Starting Reddit Gallery server processes under mapped user..."
exec su-exec node:node sh -c "node server.js & nginx"
