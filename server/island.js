// Shared island: who is walking around, where, and quick emotes.
// Positions are cosmetic (nothing is won or lost on the island), so the server only clamps and rate-limits them.
//
// Channels: the island runs as several copies of at most CHANNEL_CAP players each (like MMO channels),
// so traffic and CPU grow with the number of players instead of its square. New arrivals join the
// busiest channel that still has room, so islands feel alive; a player can also pick a channel.
//
// Traffic is kept small because every byte sent out counts against the host's bandwidth:
// - profiles (nickname, address, ELO) are sent once when someone arrives ('island:join'), never repeated
// - positions go out 5 times a second and only for players who actually moved, as a flat number array
//   [id, x, y, flags, id, x, y, flags, ...] where flags = dir | (moving << 2)
// - emotes and departures are their own tiny events
const WORLD = { w: 52 * 16, h: 38 * 16 };
const EMOTES = ['hi', 'gg', 'wow', 'lol', 'fire', 'heart'];
const TICK_MS = 200;
const CHANNEL_CAP = Number(process.env.ISLAND_CHANNEL_CAP) || 50;

function createIsland({ io, q, isFounderId = () => false, clanOf = () => null, topClan = () => null }) {
  const players = new Map();  // userId -> { id, nick, addr, elo, x, y, dir, moving, emote, emoteAt, lastMove, socketId, dirty, ch }
  const channels = new Map(); // channel number -> Set of userIds

  const room = ch => 'island:' + ch;
  const flags = p => (p.dir & 3) | (p.moving ? 4 : 0);
  const clanTag = p => { const c = p.clan; return c ? [c.tag, c.banner.bg, c.banner.fg, c.banner.sym, c.banner.pat] : 0; };
  const full = p => [p.id, p.nick, p.addr, p.elo, Math.round(p.x), Math.round(p.y), flags(p), p.emote && Date.now() - p.emoteAt < 3000 ? p.emote : '', isFounderId(p.id) ? 1 : 0, clanTag(p)];
  const clampX = v => Math.max(0, Math.min(WORLD.w, Number(v) || 0));
  const clampY = v => Math.max(0, Math.min(WORLD.h, Number(v) || 0));
  const list = () => [...channels.entries()].sort((a, b) => a[0] - b[0]).map(([id, set]) => ({ id, players: set.size, cap: CHANNEL_CAP }));

  // busiest channel with room; otherwise open the lowest free number
  function pickChannel(wanted) {
    const w = Number(wanted);
    if (Number.isInteger(w) && w > 0 && w <= 999 && (channels.get(w) || new Set()).size < CHANNEL_CAP) return w;
    let best = null;
    for (const [id, set] of channels) if (set.size < CHANNEL_CAP && (!best || set.size > channels.get(best).size)) best = id;
    if (best) return best;
    let n = 1; while (channels.has(n)) n++;
    return n;
  }

  setInterval(() => {
    const out = new Map(); // channel -> flat array
    for (const p of players.values()) {
      if (!p.dirty) continue;
      p.dirty = false;
      if (!out.has(p.ch)) out.set(p.ch, []);
      out.get(p.ch).push(p.id, Math.round(p.x), Math.round(p.y), flags(p));
    }
    for (const [ch, arr] of out) io.to(room(ch)).volatile.emit('island:pos', arr); // a dropped update is fine, the next one corrects it
  }, TICK_MS).unref();

  function removePlayer(p) {
    players.delete(p.id);
    const set = channels.get(p.ch);
    if (set) { set.delete(p.id); if (!set.size) channels.delete(p.ch); }
    io.to(room(p.ch)).emit('island:left', p.id);
  }
  function leave(socket) {
    const p = players.get(socket.data.userId);
    if (p && p.socketId === socket.id) { socket.leave(room(p.ch)); removePlayer(p); }
  }

  function onConnection(socket) {
    const userId = socket.data.userId;
    socket.on('island:enter', async (data, fn) => {
      try {
        const u = await q.userById(userId);
        const prev = players.get(u.id);
        if (prev) { // re-entering (switching channel, another tab, or a reconnect)
          const old = io.sockets.sockets.get(prev.socketId); if (old) old.leave(room(prev.ch));
          removePlayer(prev);
        }
        const ch = pickChannel(data && data.channel);
        const p = { id: u.id, nick: u.nickname, addr: u.address, elo: u.elo, clan: clanOf(u.clan_id), x: clampX(data && data.x), y: clampY(data && data.y),
          dir: 0, moving: false, emote: '', emoteAt: 0, lastMove: 0, socketId: socket.id, dirty: false, ch };
        players.set(u.id, p);
        if (!channels.has(ch)) channels.set(ch, new Set());
        channels.get(ch).add(u.id);
        socket.to(room(ch)).emit('island:join', full(p));
        socket.join(room(ch));
        const here = [...channels.get(ch)].map(id => full(players.get(id)));
        if (typeof fn === 'function') fn({ ok: true, channel: ch, cap: CHANNEL_CAP, players: here, topClan: topClan() });
      } catch (e) { if (typeof fn === 'function') fn({ ok: false, error: 'Could not join the island.' }); }
    });
    socket.on('island:channels', fn => { if (typeof fn === 'function') fn({ ok: true, channels: list(), cap: CHANNEL_CAP }); });
    socket.on('island:move', data => {
      const p = players.get(userId); if (!p || p.socketId !== socket.id || !data) return;
      const now = Date.now(); if (now - p.lastMove < 50) return; // at most 20 updates a second
      p.lastMove = now;
      p.x = clampX(data.x); p.y = clampY(data.y); p.dir = [0, 1, 2, 3].includes(data.dir) ? data.dir : 0; p.moving = !!data.moving;
      p.dirty = true;
    });
    socket.on('island:emote', e => {
      const p = players.get(userId); if (!p || p.socketId !== socket.id || !EMOTES.includes(e)) return;
      if (Date.now() - p.emoteAt < 1200) return;
      p.emote = e; p.emoteAt = Date.now();
      socket.to(room(p.ch)).emit('island:emote', [p.id, e]);
    });
    socket.on('island:leave', () => leave(socket));
    socket.on('disconnect', () => leave(socket));
  }

  return { onConnection, count: () => players.size, channels: list };
}

module.exports = { createIsland, WORLD, EMOTES, CHANNEL_CAP };
