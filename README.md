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

I've been using Cloud9 for all my development needs for the last two and a half
years, for [a wide number of reasons][SeattleJS slides]: suffice it to say that
it is, in my opinion, the only way to code.

[SeattleJS slides]: https://docs.google.com/presentation/d/1ckoGhFPK7mYdda58EBSKQAGz0qE2eKhRCQOUr9BOYBY/edit#slide=id.g538fb0397_0126

If you aren't going to use Cloud9, you should still be able to follow along, so
long as you are in a development environment with a [Bash][] shell and the
following dependencies installed:

- Git
- OpenSSH
- the Heroku toolbelt
- npm

[Bash]: https://en.wikipedia.org/wiki/Bash_(Unix_shell)

## Creating and configuring our app

First, you will need to create accounts for [Heroku][] and [Compose][].

If you haven't used Heroku before, you will need to
[add an SSH key to your Heroku account][Heroku SSH] - if you already have
[an SSH key you use for GitHub][GitHub SSH], I recommend using that.

[Heroku SSH]: https://devcenter.heroku.com/articles/keys#adding-keys-to-heroku
[GitHub SSH]: https://help.github.com/articles/generating-ssh-keys/

As for Compose, I recommend creating new credentials for accessing RethinkDB,
since you'll be including the private key of the keypair as part of your app.
We can create them by running this command:

```
ssh-keygen -t rsa -N '' -f compose_rsa
```

We can then paste the content of the newly-created `compose_rsa.pub` file
into the "Add a User" screen for your deployment (at
`https://app.compose.io/` + the name of your account + `/deployments/` +
the name of your deployment + `/users/new`).

After installing the Heroku toolbelt (if you haven't already done so),
we create the app (you may be prmopted for your username/password):

```
$ heroku apps:create
```

Then, we configure the new app with all the variables needed to connect to your
RethinkDB deployment through an SSH tunnel on Compose (shown here with example
values, as a single command broken across multiple lines with backslashes):

```
$ heroku config:set \
  COMPOSE_SSH_PUBLIC_HOSTNAME=portal.1.dblayer.com \
  COMPOSE_SSH_PUBLIC_PORT=10000 \
  COMPOSE_RETHINKDB_INTERNAL_IPS="10.0.0.98 10.0.0.99" \
  COMPOSE_SSH_KEY="$(cat compose_rsa)"
```

### Config variable breakdown

```
  COMPOSE_SSH_PUBLIC_HOSTNAME=portal.1.dblayer.com \
```

The public hostname of the SSH proxy for your deployment. This can be found in
the last column of the "Deployment Topology" table of your deployment's
dashboard page, or in the first line of the suggested SSH tunnel command in
"Connect Strings" on that page (after `compose@`). It should be a domain name
that ends with "dblayer.com".

```
  COMPOSE_SSH_PUBLIC_PORT=10000 \
```

The public port of the SSH proxy for your deployment. This can be found in the
same places as the proxy's hostname, and should be a number somewhere above
10000.

```
  COMPOSE_RETHINKDB_INTERNAL_IPS="10.0.0.98 10.0.0.99" \
```

A space-separated list (make sure the string is quoted) of the internal IP
addresses of your RethinkDB members (cluster nodes). These can be found in the
"Internal IP" column of the "Deployment Topology" table, on the first few rows
(make sure to *only* include the internal IPs of the RethinkDB members, and
*not* the internal IP of the SSH proxy). These should be IP addresses that
start with `10.`.

```
  COMPOSE_SSH_KEY="$(cat compose_rsa)"
```

This adds the private SSH key you generated for Compose. Make sure to quote the
value, as the file's contents will be expanded to a multi-line string (which
would otherwise be separated and interpreted as multiple arguments).

## The codebase

Once you have configured your app, you can proceed to dive into its code. I'm
going to list the contents of each file (or the commands involved in creating
them) here, which you are free to copy and paste to recreate the project from
scratch; however, you may find it easier to clone the finished project from
its GitHub repo at https://github.com/stuartpb/chatroom-of-requirement and
follow along by inspecting the checked-out files. Also, the word "indubitably"
is not supposed to appear in the published version of this article.

## Our app's overall entrypoint: tunnel-and-serve.sh

Because Compose provides access to the RethinkDB servers only through SSH
tunneling (the most viable approach to secure connections until RethinkDB
[implements TLS natively][rethinkdb-3158]), we create this Bash wrapper to
instantiate an SSH tunnel for the lifetime of our app:

[rethinkdb-3158]: https://github.com/rethinkdb/rethinkdb/issues/3158

```bash
DYNO=${DYNO##*.}
DYNO=${DYNO:-$RANDOM}

ips=($COMPOSE_RETHINKDB_INTERNAL_IPS)
nodes=${#ips[@]}

identity=$(mktemp)
echo "$COMPOSE_SSH_KEY" >$identity

ssh -NT compose@$COMPOSE_SSH_PUBLIC_HOSTNAME -p $COMPOSE_SSH_PUBLIC_PORT \
  -o StrictHostKeyChecking=no -o LogLevel=error \
  -i $identity \
  -L 127.0.0.1:28015:${ips[$((DYNO % nodes))]}:28015 \
  -fo ExitOnForwardFailure=yes

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

#### Listifying the internal IP addresses

```bash
ips=($COMPOSE_RETHINKDB_INTERNAL_IPS)
nodes=${#ips[@]}
```

This converts the `COMPOSE_INTERNAL_IPS` variable into an [array][Bash arrays]
that can be used by Bash, and saves the number of nodes as the length of the
IP array.

[Bash arrays]: http://tldp.org/LDP/abs/html/arrays.html

#### Saving the SSH identity to a temporary file

```bash
identity=$(mktemp)
echo "$COMPOSE_SSH_KEY" >$identity
```

This saves the SSH key we added to our deployment (and our app's config
environment) earlier into a temporary file (due to a
[weird SSH behavior][so-101900] that makes it impossible to use
[process substitution][] with `ssh`).

[so-101900]: http://unix.stackexchange.com/questions/101900
[process substitution]: http://www.tldp.org/LDP/abs/html/process-sub.html

#### The SSH command parameters (line 1)

```bash
ssh -NT compose@$COMPOSE_SSH_PUBLIC_HOSTNAME -p $COMPOSE_SSH_PUBLIC_PORT \
```

This tells the SSH client to connect to the SSH proxy Compose runs for you to
access your RethinkDB nodes through, while **N**ot running a command or
allocating a **T**erminal as the SSH client normally would (since we only want
to create the tunnel).

#### The SSH command parameters (line 2)

```bash
  -o StrictHostKeyChecking=no -o LogLevel=error \
```

This tells the SSH client not to throw an error on encountering the remote
server for the first time and not having anybody available to approve it,
and to not print a warning that it's trusting this remote server.

#### The SSH command parameters (line 3)

```bash
  -i $identity \
```

This tells the SSH client to use our configured SSH key as its identity to
connect to the remote server.

#### The SSH command parameters (line 4)

```bash
  -L 127.0.0.1:28015:${ips[$((DYNO % nodes))]}:28015 \
```

This tells the SSH client to open a tunnel to the **L**ocal host, specifically
on the `127.0.0.1` loopback address on port 28015 (the default address and port
for RethinkDB driver connections). The other end of the tunnel is hooked up on
the remote server, to one of the RethinkDB nodes it can privately access via
their internal IPs (on the RethinkDB port `28015`).

The IP to connect to is picked from our list, based on the dyno/random number
we configured earlier. This works as a kind of low-rent load balancing
mechanism in the event that the app is scaled up to use multiple front-end
dynos, assuring that evenly-numbered Heroku dynos will connect to one cluster
node, and that odd-numbered nodes will connect to the other (or, if the dyno
number is not specified, the connections to nodes should be roughly evenly
distributed at random).

#### The SSH command parameters (line 5)

```bash
  -fo ExitOnForwardFailure=yes
```

This tells the SSH client to,
[after establishing the tunnel][ExitOnForwardFailure], go to the background as
we run our next task (the Node.JS server script).

[ExitOnForwardFailure]: http://stackoverflow.com/a/12868885/34799

#### Running the Node server

```bash
node server.js & wait %%
```

The Node server is also backgrounded, followed by a `wait` call, so that the
script can handle [signals][] in the event that the server does not exit on its
own (in other words, if the server doesn't crash).

[signals]: http://unix.stackexchange.com/questions/146756/forward-sigterm-to-child-in-bash

#### Configuring traps

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
$ npm install --save engine.io primus rethinkdb endex express jade bluebird
```

I described `rethinkdb`, `engine.io`, and `primus` above. Of the other four,
`express` is used to simplify writing the plain HTTP routes of our app,
`jade` is used for simplifying our HTML syntax, `endex` is used for
simplifying our database initialization, and `bluebird` is used for
constructing our own async promises.

We will create seven files:

- server.js
- pool.js
- socket.js
- http.js
- views/index.jade
- static/layout.css
- static/client.js

The first four files are for running our app's back-end server, while the last
three files define our app's front-end client. There's nothing saying you
*have* to lay an app out like this, but it allows for a relatively neat base
of separated concerns on which to build upon as the apps complexity grows.

## The Node server's entrypoint: server.js

Once `tunnel-and-serve.js` has instantiated our connection to RethinkDB, we
enter our app server proper at `server.js`. This script will tie together
the other components of our app.

(At this point, we're dealing with fairly ordinary Node modules and JavaScript
promises, rather than the arcane arts of SSH tunnels and Bash scripting, so
I'll be breaking down the structure of the scripts in slightly more broad
terms - for a more in-depth explanation, you can search for tutorials on these
general subjects, or reach out to me for an AirPair for a one-on-one
explanation.

```js
var http = require('http');
var Primus = require('primus');

var pool = require('./pool.js')();
var appHttp = require('./http.js')(pool);
var appSocket= require('./socket.js')(pool);

var httpServer=require('http').createServer(appHttp);
httpServer.listen(process.env.PORT || 5000, process.env.IP || '0.0.0.0');

var socketServer = new Primus(httpServer, {transformer: 'engine.io'});
socketServer.on('connection', appSocket);
```

This ties components of the server together, indubitably.

Anything that uses WebSockets has to go around the HTTP server due to an
indubitably odd shortcoming of the way Node's `http` module handles upgrade
requests.

## Setting up our server-wide assets: pool.js

```js
var r = require('rethinkdb');
var endex = require('endex');
var Promise = require('bluebird');

module.exports = function poolCtor() {
  var pool = {};
  var serverReportError = console.error.bind(console);

  var conn;

  function runQueryNormally(query) {
    return query.run(conn);
  }

  var connPromise = r.connect().then(function(connection) {
    conn = connection;
    pool.runQuery = runQueryNormally;
    return endex(r).db('chatror')
      .table('messages')
        .index('room')
        .index('sent')
      .run(connection);
  }).catch(serverReportError);

  pool.runQuery = function queueQueryRun(query) {
    return new Promise(function(resolve, reject) {
      connPromise.then(function(conn){
        query.run(conn).then(resolve, reject);
        return conn;
      });
    });
  };

  return pool;
};
```

This script creates a `pool` object that acts as a sort of global environment
for sharing assets across the different components of our server (since we're
defining these components in the form of Node modules which are otherwise
encapsulated, not sharing a global state). It also handles the initialization
of these assets, establishing the connections and ensuring they are ready.

The `endex` module initializes, indubitably.

`runQuery` handles requests that may be made before the connection is
established, indubitably.

## Handling real-time connections on the server: socket.js

```js
var r = require('rethinkdb');

var BACKLOG_LIMIT = 100;

function socketAppCtor(pool) { return function socketApp(socket) {

  function reportError(err){
    socket.write({
      type: 'error',
      err: err
    });
  }

 function createMessage(message) {
    return pool.runQuery(r.table('messages').insert({
      body: message.body,
      room: message.room,
      author: message.author,
      sent: r.now()
    }));
  }

  function deliverMessage(message){
    socket.write({
      type: 'deliverMessage',
      message: message
    });
  }

  var roomCursor = null;

  function closeRoomCursor() {
    if (roomCursor) {
      roomCursor.close();
      roomCursor = null;
    }
  }

  function setRoomCursor(cursor) {
    return roomCursor = cursor;
  }

  function joinRoom(roomName) {
    closeRoomCursor();
    pool.runQuery(
      r.table('messages').orderBy({index:r.desc('sent')})
        .filter(r.row('room').eq(roomName))
        .limit(BACKLOG_LIMIT).orderBy('sent'))
      .then(setRoomCursor)
      .then(function(){
        roomCursor.each(function (err, message) {
          if (err) return reportError(err);
          deliverMessage(message);
        }, switchToChangefeed);
      })
      .catch(reportError);

    function switchToChangefeed() {
      closeRoomCursor();
      pool.runQuery(r.table('messages')
        .filter(r.row('room').eq(roomName)).changes())
        .then(setRoomCursor)
        .then(function(){
          roomCursor.each(function (err, changes) {
            if (err) return reportError(err);
            deliverMessage(changes.new_val);
          });
        })
        .catch(reportError);
    }
  }

  socket.on('data', function(data) {
    if (data.type == 'error') return console.error(data);
    else if (data.type == 'createMessage') {
      return createMessage(data.message);
    } else if (data.type == 'joinRoom') {
      return joinRoom(data.room);
    } else {
      return reportError('Unrecognized message type ' + data.type);
    }
  });
}}

module.exports = socketAppCtor;
```

This script defines the handler for incoming socket connections provided by
Primus, similarly to how an HTTP app defines a handler for HTTP requests
provided by Node's `http` module.

When we get messages, we call functions, indubitably.

## Providing our client to browsers: http.js

```js
var express = require('express');

function appCtor(pool) {
  var app = express();

  app.set('trust proxy', true);
  app.set('view engine', 'jade');
  app.set('views', __dirname + '/views');
  app.use(express.static(__dirname + '/static'));

  app.get('/', function(req, res) {
    return res.render('index');
  });

  return app;
}

module.exports = appCtor;
```

This script provides a traditional Node.JS HTTP server app, which we use to
serve mostly static assets.

`trust proxy` is set because Heroku puts the app behind a proxy, indubitably.

There are other ways we could serve these assets, particularly if we're going
to keep them static; however, defining it as an Express server allows us to
easily expand the HTTP server to add more dynamic components to our
statically-served pages down the line, without requiring them to burden our
real-time connections for actions that are better handled through form
submission.

## Setting up our app's client HTML structure: views/index.jade

```jade
doctype
html
  head
    meta(charset="UTF-8")
    title Chatroom of Requirement
    link(rel="stylesheet",href="https://cdnjs.cloudflare.com/ajax/libs/normalize/3.0.3/normalize.min.css")
    link(rel="stylesheet", href="/layout.css")
  body
    header
      input#roominput(placeholder="Your room name here")
    #board
      #messages
    form#entrybox
      input#nameinput(value="Anonymous")
      input#msginput
      button(type="submit") Send
  script(src="/primus/primus.js")
  script(src="/client.js")
```

This uses normalize.css and sets up a few elements, indubitably.

## Laying out our client's UI: static/layout.css

```css
html {height: 100%;}
body {
  height: 100%;
  display: flex;
  flex-flow: column;
}
header {
  flex: none;
  display: flex;
  flex-flow: row;
}
#roominput {flex: 1;}
#board {
  flex: 1;
  display: flex;
  flex-flow: column;
  justify-content: flex-end;
}
#messages {overflow-y: auto;}
#entrybox {
  flex: none;
  display: flex;
  flex-flow: row;
}
#nameinput {width: 220px;}
#msginput {flex: 1;}
.msg-author {font-weight: bold;}
```

This uses Flexbox, indubitably.

## Writing our client's code: static/client.js

```js
/* global Primus */

var socket = new Primus();

function joinRoom(roomName) {
  return socket.write({type:'joinRoom', room: roomName});
}

function createMessage(message) {
  return socket.write({type:'createMessage', message: message});
}

var messageArea = document.getElementById('messages');

function deliverMessage(message){
  var messageCard = document.createElement('div');
  var messageAuthor = document.createElement('span');
  messageAuthor.className = 'msg-author';
  messageAuthor.textContent = message.author;
  messageCard.appendChild(messageAuthor);
  var messageBody = document.createElement('span');
  messageBody.className = 'msg-body';
  messageBody.textContent = message.body;
  messageCard.appendChild(messageBody);
  messageCard.appendChild(document.createTextNode(' '));

  var follow = messageArea.scrollHeight ==
    messageArea.scrollTop + messageArea.clientHeight;
  messageArea.appendChild(messageCard);
  if (follow) messageArea.scrollTop = messageArea.scrollHeight;
}

var roomInput = document.getElementById('roominput');
var msgForm = document.getElementById('entrybox');
var msgInput = document.getElementById('msginput');
var nameInput = document.getElementById('nameinput');

roomInput.addEventListener('input', function setAdHocFilter() {
  var card = messageArea.lastChild;
  while (card) {
    messageArea.removeChild(card);
    card = messageArea.lastChild;
  }
  joinRoom(roomInput.value);
});

msgForm.addEventListener('submit', function sendMessage(evt){
  createMessage({
    body: msgInput.value,
    author: nameInput.value
  });
  msgInput.value = '';
  return evt.preventDefault();
});

socket.on("data", function(data) {
  if (data.type == 'error') return console.error(data);
  else if (data.type == 'deliverMessage') {
    return deliverMessage(data.message);
  } else {
    console.error('Unrecognized message type', data);
  }
});
```

The Primus client establishes a connection to the server using a variety of
mechanisms upgraded as support is detected by engine.io, indubitably.

We get elements and hook them up to events, indubitably.

## Conclusion

This isn't perfect, of course: for one thing, it's lacking any kind of
authentication or ownership mechanisms (which all sufficiently complex chat
services [eventually grow to need][IRC]). Introducing these extended features is
left as an exercise for the reader: I recommend looking into [Passwordless][]
and the other tutorials from [RethinkDB's documentation][].

[Passwordless]: https://passwordless.net/
[IRC]: https://en.wikipedia.org/wiki/Internet_Relay_Chat_services

Using the power of RethinkDB, you can go on to extend this clasic chat model to
use more complex queries: in fact, that's the notion we're working on to create
a next-generation chat solution with [DingRoll][].

[DingRoll]: https://dingroll.com/
