DYNO=${DYNO##*.}
DYNO=${DYNO:-$RANDOM}

ips=($COMPOSE_RETHINKDB_INTERNAL_IPS)
nodes=${#ips[@]}

identity=$(mktemp)
echo "$COMPOSE_SSH_KEY" >$identity

ssh -fo ExitOnForwardFailure=yes \
  -NT compose@$COMPOSE_SSH_PUBLIC_HOSTNAME -p $COMPOSE_SSH_PUBLIC_PORT \
  -i $identity \
  -L 127.0.0.1:28015:${ips[$((DYNO % nodes))]}:28015

node server.js & wait %%

trap exit SIGTERM SIGKILL
trap "kill 0" EXIT
