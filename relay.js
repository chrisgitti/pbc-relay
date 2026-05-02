const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

const rooms = {}; // code → { host: ws, guest: ws|null, hostName: string }

function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

wss.on('connection', ws => {
  let myRoom = null;
  let myRole = null; // 'host' | 'guest'

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const code = generateCode();
      rooms[code] = { host: ws, guest: null, hostName: msg.name || 'Spieler 1' };
      myRoom = code; myRole = 'host';
      ws.send(JSON.stringify({ type: 'created', code, role: 'host' }));
    }
    else if (msg.type === 'join') {
      const room = rooms[msg.code];
      if (!room) { ws.send(JSON.stringify({ type: 'error', msg: 'Raum nicht gefunden' })); return; }
      if (room.guest) { ws.send(JSON.stringify({ type: 'error', msg: 'Raum bereits voll' })); return; }
      room.guest = ws; myRoom = msg.code; myRole = 'guest';
      room.host.send(JSON.stringify({ type: 'start', role: 'host', opponentName: msg.name || 'Spieler 2' }));
      ws.send(JSON.stringify({ type: 'start', role: 'guest', opponentName: room.hostName }));
    }
    else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
    else {
      // Alle anderen Nachrichten blind weiterleiten (shot, respawn, rematch …)
      const room = rooms[myRoom];
      if (!room) return;
      const opponent = myRole === 'host' ? room.guest : room.host;
      if (opponent?.readyState === WebSocket.OPEN) opponent.send(raw.toString());
    }
  });

  ws.on('close', () => {
    if (!myRoom || !rooms[myRoom]) return;
    const room = rooms[myRoom];
    const opponent = myRole === 'host' ? room.guest : room.host;
    if (opponent?.readyState === WebSocket.OPEN) {
      opponent.send(JSON.stringify({ type: 'disconnect' }));
    }
    delete rooms[myRoom];
  });
});

console.log(`PBC Relay läuft auf Port ${process.env.PORT || 8080}`);
