DYNO=${DYNO##*.}
DYNO=${DYNO:-$RANDOM}

ips=($COMPOSE_RETHINKDB_INTERNAL_IPS)
nodes=${#ips[@]}

ssh -NT compose@$COMPOSE_SSH_PUBLIC_HOSTNAME -p $COMPOSE_SSH_PUBLIC_PORT \
  -i <(echo "$COMPOSE_SSH_KEY") \
  -L 127.0.0.1:28015:${ips[$((DYNO % nodes))]}:28015 &

node server.js & wait %%

trap exit SIGTERM SIGKILL
trap "kill 0" EXIT
