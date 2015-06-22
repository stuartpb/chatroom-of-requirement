var r = require('rethinkdb');
var endex = require('endex');

module.exports = function poolCtor() {
  var pool = {};
  var serverReportError = console.error.bind(console);

  var conn;

  function runQueryNormally(query) {
    return query.run(conn);
  }

  var connPromise = r.connect().then(function (connection) {
    return endex(r).db('chatror')
      .table('messages')
        .index('room')
        .index('sent')
      .run(connection);
  }).then(function (connection) {
    conn = connection;
    pool.runQuery = runQueryNormally;
  }).catch(serverReportError);

  pool.runQuery = function queueQueryRun(query) {
    return connPromise.then(function () {
      return query.run(conn);
    });
  };

  return pool;
};
