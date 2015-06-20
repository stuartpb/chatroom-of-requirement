# The Chatroom of Requirement: Building and Deploying A Real-Time Chat App

Web developers in 2015 find themselves with an embarrasment of riches in
open-source technologies for developing real-time apps:

- [RethinkDB][], on top of being a *really* well-designed document store in
  general, provides the killer feature of [changefeeds][], allowing servers to
  have the document store notify them whenever activity on a query occurs
  without having to continuously poll the database.
- [Node.JS][] allows server code to effortlessly switch between tasks while
  waiting on I/O.
- [engine.io][] allows developers to use WebSockets for real-time code, while
  still working through simpler mechanisms if the upgrade to WebSockets fails.
- [Primus][] allows developers to code against a number of real-time libraries
  (such as engine.io) using one simple WebSocket-like model, without having to
  worry about potential differences between implementations in terms of
  low-level details like reconnection.

[RethinkDB]: http://rethinkdb.com/
[changefeeds]: http://rethinkdb.com/docs/changefeeds/javascript/
[Node.JS]: https://nodejs.org/
[engine.io]: https://github.com/Automattic/engine.io
[Primus]: https://github.com/primus/primus

Using these technologies, not only can you *build* real-time apps easily, you
can *deploy* them easily on [Heroku][], with [Compose][] providing a RethinkDB
cluster.

[Heroku]: https://www.heroku.com/
[Compose]: https://www.compose.io/

Assuming you have a working knowledge of running shell commands, this should
give you a step-by-step breakdown of exactly what's required to deploy such an
app in production, as seen at https://chatroom-of-requirement.herokuapp.com/.

## My development environment

I'm using a free public workspace provided by Cloud9. You can create your own
at https://c9.io/ (I recommend creating a "Custom" workspace, or creating a
fresh README-initialized repo on GitHub and then cloning that), or you can take
a look at the workspace I'm using at
https://ide.c9.io/stuartpb/chatroom-of-requirement (all the files should look
the same as what you'd see [in the GitHub repo I'm pushing it to][repo]).

[repo]: https://github.com/stuartpb/chatroom-of-requirement

I've been using
Cloud9 for all my development needs for the last two and a half years, for
[a wide number of reasons][SeattleJS slides]: suffice it to say that it is,
in my opinion, the only way to code.

[SeattleJS slides]: https://docs.google.com/presentation/d/1ckoGhFPK7mYdda58EBSKQAGz0qE2eKhRCQOUr9BOYBY/edit#slide=id.g538fb0397_0126

## Creating and configuring the app

Sign up for Heroku and Compose accounts.

After authenticating to the Heroku toolbelt (if you haven't already done so),
create the app:

```
$ heroku apps:create
```

Then, add your key from Compose as a config variable for the app. Multi-line
values like this key are fine, so long as you make sure to quote the string

```
$ heroku config:set "COMPOSE_IO_SSH_KEY=

"
```

## Our app's overall entrypoint: tunnel-and-serve.sh

Because Compose provides access to the RethinkDB servers only through SSH
tunneling (the most viable approach to secure connections until RethinkDB
[implements TLS natively][rethinkdb-3158]), we create this Bash wrapper to
instantiate an SSH tunnel for the lifetime of our app:

[rethinkdb-3158]: https://github.com/rethinkdb/rethinkdb/issues/3158

```bash
DYNO=${DYNO##*.}
DYNO=${DYNO:-$RANDOM}

ssh compose@portal.1.dblayer.com -i <(echo "$COMPOSE_IO_SSH_KEY") -p 10000 \
  -NTL localhost:28015:10.0.0.$((99 - DYNO % 2)):28015 &

node server.js & wait %%

trap exit SIGTERM SIGKILL
trap "kill 0" EXIT
```

### Clause-by-clause breakdown

#### Getting (or faking) the dyno number

```bash
DYNO=${DYNO##*.}
DYNO=${DYNO:-$RANDOM}
```

These lines convert the [Heroku-provided dyno identifier][dyno vars] to the
dyno's number, or (in the event that Heroku discontinues the `$DYNO`
environment variable or it is otherwise unavailable) picks a number at random.
This dyno (or random) number is used later when picking which Compose-provided
RethinkDB cluster node to connect to.

[dyno vars]: https://devcenter.heroku.com/articles/dynos#local-environment-variables

#### The SSH command parameters

```bash
ssh compose@portal.1.dblayer.com -i <(echo "$COMPOSE_IO_SSH_KEY") -p 10000 \
```

This tells the SSH client to connect to Compose's servers, using
(via [process substitution][]) the SSH key we added to our app's config
environment earlier, on port 10000 (the port Compose
[generally prefers to use][compose docs] for incoming connections to their
databases).

[process substitution]: http://www.tldp.org/LDP/abs/html/process-sub.html
[compose docs]: https://docs.compose.io/getting-started/compose.html

#### The SSH command parameters, continued

```bash
  -NTL 127.0.0.1:28015:10.0.0.$((99 - DYNO % 2)):28015 &
```

This tells the SSH client to open a tunnel to the **L**ocal host (while
**N**ot running a command or allocating a **T**erminal), specifically on the
`127.0.0.1` loopback address on port 28015 (the default address and port for
RethinkDB driver connections). The other end of the tunnel is hooked up on the
remote server, to one of the RethinkDB nodes it can privately access at either
`10.0.0.98` or `10.0.0.99` (on the RethinkDB port `28015`).

The dyno/random number is used as a kind of low-rent load balancing mechanism
in the event that the app is scaled up to use multiple front-end dynos,
assuring that evenly-numbered Heroku dynos will connect to one cluster node,
and that odd-numbered nodes will connect to the other (or, if the dyno number
is not specified, the connections to should be roughly evenly distributed
at random).

The `&` at the end tells Bash to run this tunnel in the background, as we run
our next task: our Node.JS server script.

```bash
node server.js & wait %%
```

The Node server is also backgrounded, followed by a `wait` call, so that the
script can handle [signals][] in the event that the server does not exit on its
own (in other words, if the server doesn't crash).

[signals]: http://unix.stackexchange.com/questions/146756/forward-sigterm-to-child-in-bash

```bash
trap exit SIGTERM SIGKILL
trap "kill 0" EXIT
```

These configure the script to exit when receiving a termination signal,
and to clean up all its lingering jobs (ie. the tunnel and the server) when
exiting.

## Bringing up the app's scaffolding

To tell Heroku to use this script we've written to start the server, we can
create a simple, one-line Procfile:

```
$ echo 'web: bash tunnel-and-serve.sh' > Procfile
```

We can then use `npm init` to create an empty `package.json`, and then use
`npm install --save` to populate that `package.json` with our app's
dependencies (installing them locally in the process):

```
$ npm init
$ npm install --save engine.io primus rethinkdb endex express jade
```

I described `rethinkdb`, `engine.io`, and `primus` above. Of the other three,
`express` is used to simplify writing the plain HTTP routes of our app,
`jade` is used for simplifying our HTML syntax, and `endex` is used for
simplifying our database initialization.

We will create six files:

- views/index.jade
- static/client.js
- server.js
- pool.js
- http.js
- socket.js



This isn't perfect, of course: it's lacking any kind of authentication system

You can go on to extend this to more complex queries: in fact, that's the
notion we're working on to create a next-generation chat solution with
[DingRoll][].

[DingRoll]: https://dingroll.com/
