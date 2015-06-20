DYNO=${DYNO##*.}
DYNO=${DYNO:-$RANDOM}

ssh compose@portal.1.dblayer.com -i <(echo "$COMPOSE_IO_SSH_KEY") -p 10000 \
  -NTL localhost:28015:10.0.0.$((99 - DYNO % 2)):28015 &

node server.js & wait %%

trap exit SIGTERM SIGKILL
trap "kill 0" EXIT