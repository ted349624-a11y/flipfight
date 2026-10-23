// Shared island: who is walking around, where, and quick emotes.
// Positions are cosmetic (nothing is won or lost on the island), so the server only clamps and rate-limits them.
//
// Traffic is kept small because every byte sent out counts against the host's bandwidth:
// - profiles (nickname, address, ELO) are sent once when someone arrives ('island:join'), never repeated
// - positions go out 5 times a second and only for players who actually moved, as a flat number array
//   [id, x, y, flags, id, x, y, flags, ...] where flags = dir | (moving << 2)
// - emotes and departures are their own tiny events
const WORLD = { w: 52 * 16, h: 38 * 16 };
const EMOTES = ['hi', 'gg', 'wow', 'lol', 'fire', 'heart'];
const TICK_MS = 200;

function createIsland({ io, q, G }) {
  const players = new Map(); // userId -> { id, nick, addr, elo, x, y, dir, moving, emote, emoteAt, lastMove, socketId, dirty }

  const profile = p => [p.id, p.nick, p.addr, p.elo];
  const flags = p => (p.dir & 3) | (p.moving ? 4 : 0);
  const full = p => [p.id, p.nick, p.addr, p.elo, Math.round(p.x), Math.round(p.y), flags(p), p.emote && Date.now() - p.emoteAt < 3000 ? p.emote : ''];
  const clampX = v => Math.max(0, Math.min(WORLD.w, Number(v) || 0));
  const clampY = v => Math.max(0, Math.min(WORLD.h, Number(v) || 0));

  setInterval(() => {
    const out = [];
    for (const p of players.values()) {
      if (!p.dirty) continue;
      p.dirty = false;
      out.push(p.id, Math.round(p.x), Math.round(p.y), flags(p));
    }
    if (out.length) io.to('island').volatile.emit('island:pos', out); // a dropped update is fine, the next one corrects it
  }, TICK_MS).unref();

  function leave(socket) {
    const id = socket.data.userId;
    socket.leave('island');
    const p = players.get(id);
    if (p && p.socketId === socket.id) { players.delete(id); io.to('island').emit('island:left', id); }
  }

  function onConnection(socket) {
    const userId = socket.data.userId;
    socket.on('island:enter', async (data, fn) => {
      try {
        const u = await q.userById(userId);
        const prev = players.get(u.id);
        const p = { id: u.id, nick: u.nickname, addr: u.address, elo: u.elo, x: clampX(data && data.x), y: clampY(data && data.y),
          dir: 0, moving: false, emote: '', emoteAt: 0, lastMove: 0, socketId: socket.id, dirty: false };
        players.set(u.id, p);
        if (prev && prev.socketId !== socket.id) { const old = io.sockets.sockets.get(prev.socketId); if (old) old.leave('island'); }
        socket.to('island').emit('island:join', [...profile(p), Math.round(p.x), Math.round(p.y), 0]);
        socket.join('island');
        if (typeof fn === 'function') fn({ ok: true, players: [...players.values()].map(full) });
      } catch (e) { if (typeof fn === 'function') fn({ ok: false, error: 'Could not join the island.' }); }
    });
    socket.on('island:move', data => {
      const p = players.get(userId); if (!p || p.socketId !== socket.id || !data) return;
      const now = Date.now(); if (now - p.lastMove < 50) return; // at most 20 updates a second
      p.lastMove = now;
      p.x = clampX(data.x); p.y = clampY(data.y); p.dir = [0, 1, 2, 3].includes(data.dir) ? data.dir : 0; p.moving = !!data.moving;
      p.dirty = true;
    });
    socket.on('island:emote', e => {
      const p = players.get(userId); if (!p || !EMOTES.includes(e)) return;
      if (Date.now() - p.emoteAt < 1200) return;
      p.emote = e; p.emoteAt = Date.now();
      socket.to('island').emit('island:emote', [p.id, e]);
    });
    socket.on('island:leave', () => leave(socket));
    socket.on('disconnect', () => leave(socket));
  }

  return { onConnection, count: () => players.size };
}

module.exports = { createIsland, WORLD, EMOTES };
