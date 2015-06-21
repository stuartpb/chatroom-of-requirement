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
