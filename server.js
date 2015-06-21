var http = require('http');
var Primus = require('primus');

var pool = require('./pool.js')();
var appHttp = require('./http.js')(pool);
var appSocket= require('./socket.js')(pool);

var httpServer=require('http').createServer(appHttp);
httpServer.listen(process.env.PORT || 5000, process.env.IP || '0.0.0.0');

var socketServer = new Primus(httpServer, {transformer: 'engine.io'});
socketServer.on('connection', appSocket);
