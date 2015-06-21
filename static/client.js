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
    room: roomInput.value,
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


// start out in the "lobby"
joinRoom('');
