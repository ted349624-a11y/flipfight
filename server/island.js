// Shared island: who is walking around, where, and quick emotes.
// Positions are cosmetic (nothing is won or lost on the island), so the server only clamps and rate-limits them.
const WORLD = { w: 52 * 16, h: 38 * 16 };
const EMOTES = ['hi', 'gg', 'wow', 'lol', 'fire', 'heart'];

function createIsland({ io, q, G }) {
  const players = new Map(); // userId -> { id, nick, addr, elo, x, y, dir, moving, emote, emoteAt, lastMove }
  let dirty = false;

  const view = p => [p.id, p.nick, Math.round(p.x), Math.round(p.y), p.dir, p.moving ? 1 : 0, p.addr, p.elo, p.emote && Date.now() - p.emoteAt < 3000 ? p.emote : ''];
  const clampX = v => Math.max(0, Math.min(WORLD.w, Number(v) || 0));
  const clampY = v => Math.max(0, Math.min(WORLD.h, Number(v) || 0));

  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    io.to('island').emit('island:state', { t: Date.now(), players: [...players.values()].map(view) });
  }, 100).unref();

  function leave(socket) {
    const id = socket.data.userId;
    socket.leave('island');
    if (players.get(id) && players.get(id).socketId === socket.id) { players.delete(id); dirty = true; }
  }

  function onConnection(socket) {
    const userId = socket.data.userId;
    socket.on('island:enter', async (data, fn) => {
      try {
        const u = await q.userById(userId);
        const p = { id: u.id, nick: u.nickname, addr: u.address, elo: u.elo, x: clampX(data && data.x), y: clampY(data && data.y),
          dir: 0, moving: false, emote: '', emoteAt: 0, lastMove: 0, socketId: socket.id };
        players.set(u.id, p);
        socket.join('island');
        dirty = true;
        if (typeof fn === 'function') fn({ ok: true, players: [...players.values()].map(view) });
      } catch (e) { if (typeof fn === 'function') fn({ ok: false, error: 'Could not join the island.' }); }
    });
    socket.on('island:move', data => {
      const p = players.get(userId); if (!p || !data) return;
      const now = Date.now(); if (now - p.lastMove < 50) return; // at most 20 updates a second
      p.lastMove = now;
      p.x = clampX(data.x); p.y = clampY(data.y); p.dir = [0, 1, 2, 3].includes(data.dir) ? data.dir : 0; p.moving = !!data.moving;
      dirty = true;
    });
    socket.on('island:emote', e => {
      const p = players.get(userId); if (!p || !EMOTES.includes(e)) return;
      if (Date.now() - p.emoteAt < 1200) return;
      p.emote = e; p.emoteAt = Date.now(); dirty = true;
      setTimeout(() => (dirty = true), 3100); // clear the bubble for everyone
    });
    socket.on('island:leave', () => leave(socket));
    socket.on('disconnect', () => leave(socket));
  }

  return { onConnection, count: () => players.size };
}

module.exports = { createIsland, WORLD, EMOTES };
