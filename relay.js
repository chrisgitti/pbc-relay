const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

const rooms = {}; // code → { host, guest, hostName, spectators[] }
const MAX_SPECTATORS = 50;

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O und 1/I
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function broadcastToRoom(room, raw, senderWs) {
  const targets = [];
  if (room.host && room.host !== senderWs) targets.push(room.host);
  if (room.guest && room.guest !== senderWs) targets.push(room.guest);
  for (const sp of room.spectators) {
    if (sp !== senderWs && sp.readyState === WebSocket.OPEN) targets.push(sp);
  }
  for (const t of targets) {
    if (t.readyState === WebSocket.OPEN) t.send(raw);
  }
}

wss.on('connection', ws => {
  let myRoom = null;
  let myRole = null; // 'host' | 'guest' | 'spectator'

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const code = generateCode();
      rooms[code] = { host: ws, guest: null, hostName: msg.name || 'Spieler 1', spectators: [] };
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
    else if (msg.type === 'spectate') {
      const room = rooms[msg.code];
      if (!room || !room.guest) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Raum nicht gefunden oder noch kein Spiel aktiv' }));
        return;
      }
      if (room.spectators.length >= MAX_SPECTATORS) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Maximale Zuschauerzahl erreicht' }));
        return;
      }
      room.spectators.push(ws);
      myRoom = msg.code; myRole = 'spectator';
      ws.send(JSON.stringify({ type: 'spectating' }));
      if (room.host?.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({ type: 'spectator_joined' }));
      }
    }
    else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
    else {
      // Alle anderen Nachrichten an Gegenspieler + alle Zuschauer weiterleiten
      const room = rooms[myRoom];
      if (!room) return;
      broadcastToRoom(room, raw.toString(), ws);
    }
  });

  ws.on('close', () => {
    if (!myRoom || !rooms[myRoom]) return;
    const room = rooms[myRoom];
    if (myRole === 'spectator') {
      room.spectators = room.spectators.filter(s => s !== ws);
      return; // Raum bleibt bestehen, Spieler werden nicht benachrichtigt
    }
    // Spieler (host/guest) trennt → Gegenspieler + alle Zuschauer benachrichtigen
    const opponent = myRole === 'host' ? room.guest : room.host;
    if (opponent?.readyState === WebSocket.OPEN) {
      opponent.send(JSON.stringify({ type: 'disconnect' }));
    }
    for (const sp of room.spectators) {
      if (sp.readyState === WebSocket.OPEN)
        sp.send(JSON.stringify({ type: 'disconnect' }));
    }
    delete rooms[myRoom];
  });
});

console.log(`PBC Relay läuft auf Port ${process.env.PORT || 8080}`);
