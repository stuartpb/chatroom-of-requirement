var r = require('rethinkdb');

var BACKLOG_LIMIT = 100;

function socketAppCtor(cfg, pool) { return function socketApp(socket) {

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
