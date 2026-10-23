// Clans: create (50,000 FLIP, burned), join (open or by approval), leave, kick, approve, transfer, edit, disband.
// A small in-memory cache of every clan (id -> tag, name, banner) lets profiles, matches, the island and the
// leaderboard show a member's banner next to their nickname without extra database queries.
function createClans({ db, G, now = () => Date.now() }) {
  const C = G.CLAN;
  const cache = new Map(); // id -> { id, name, tag, banner, leaderId, joinMode, points, members }
  let top = null;          // the season's leading clan (its banner flies over the island plaza)

  const view = c => c && { id: c.id, name: c.name, tag: c.tag, banner: c.banner };
  const clanOf = id => view(cache.get(id)) || null;
  const fromRow = r => ({ id: r.id, name: r.name, tag: r.tag, banner: JSON.parse(r.banner), leaderId: r.leader_id, joinMode: r.join_mode, points: r.season_points, members: Number(r.members || 0) });

  async function refresh(id, c) {
    const r = await db.one(`SELECT cl.*, (SELECT COUNT(*) FROM users u WHERE u.clan_id = cl.id) AS members FROM clans cl WHERE cl.id = $1`, [id], c);
    if (r) cache.set(id, fromRow(r)); else cache.delete(id);
  }
  async function refreshTop(c) {
    const r = await db.one('SELECT id FROM clans WHERE season_points > 0 ORDER BY season_points DESC, id ASC LIMIT 1', [], c);
    top = r ? r.id : null;
  }
  async function load() {
    cache.clear();
    for (const r of await db.all(`SELECT cl.*, (SELECT COUNT(*) FROM users u WHERE u.clan_id = cl.id) AS members FROM clans cl`)) cache.set(r.id, fromRow(r));
    await refreshTop();
  }

  // called inside the match transaction when a member wins a ranked match
  async function onWin(userId, c) {
    const r = await db.one('UPDATE clans SET season_points = season_points + 1 WHERE id = (SELECT clan_id FROM users WHERE id = $1) RETURNING id, season_points', [userId], c);
    if (r) { const cl = cache.get(r.id); if (cl) cl.points = r.season_points; if (!top || (cache.get(top) || {}).points <= r.season_points) top = r.id; }
  }
  async function seasonReset(c) { await db.query('UPDATE clans SET season_points = 0', [], c); }
  const afterSeasonReset = () => { for (const cl of cache.values()) cl.points = 0; top = null; };
  const topClan = () => (top && cache.get(top) ? { ...view(cache.get(top)), points: cache.get(top).points } : null);

  // ---------- API ----------
  function register(app, { auth, route, fail }) {
    const cleanName = n => String(n || '').trim().replace(/\s+/g, ' ');
    const err = (res, msg, code = 400) => fail(res, code, msg);

    app.get('/api/clans', auth, route(async (req, res) => {
      const qs = String(req.query.q || '').trim().toLowerCase();
      let list = [...cache.values()];
      if (qs) list = list.filter(c => c.name.toLowerCase().includes(qs) || c.tag.toLowerCase().includes(qs));
      list.sort((a, b) => b.points - a.points || b.members - a.members || a.id - b.id);
      const reqs = (await db.all('SELECT clan_id FROM clan_requests WHERE user_id = $1', [req.user.id])).map(r => r.clan_id);
      res.json({
        clans: list.slice(0, 100).map((c, i) => ({ ...view(c), rank: i + 1, points: c.points, members: c.members, joinMode: c.joinMode, requested: reqs.includes(c.id) })),
        myClanId: req.user.clan_id || null, total: cache.size, rules: { cost: C.createCost, max: C.maxMembers },
      });
    }));

    app.get('/api/clan/:id', auth, route(async (req, res) => {
      const id = Number(req.params.id), cl = cache.get(id);
      if (!cl) return err(res, 'That clan no longer exists.', 404);
      const members = await db.all(`SELECT id, nickname, elo, season_wins, season_played FROM users WHERE clan_id = $1 ORDER BY (id = $2) DESC, season_wins DESC, elo DESC`, [id, cl.leaderId]);
      const isLeader = cl.leaderId === req.user.id;
      const requests = isLeader ? await db.all(`SELECT u.id, u.nickname, u.elo FROM clan_requests r JOIN users u ON u.id = r.user_id WHERE r.clan_id = $1 ORDER BY r.created_at`, [id]) : [];
      const requested = !!(await db.one('SELECT 1 FROM clan_requests WHERE clan_id = $1 AND user_id = $2', [id, req.user.id]));
      res.json({
        clan: { ...view(cl), leaderId: cl.leaderId, joinMode: cl.joinMode, points: cl.points, members: cl.members, max: C.maxMembers },
        members: members.map(m => ({ id: m.id, nickname: m.nickname, elo: m.elo, tier: G.tierOf(m.elo).id, seasonWins: m.season_wins, seasonPlayed: m.season_played, leader: m.id === cl.leaderId })),
        requests, isLeader, isMember: req.user.clan_id === id, requested,
      });
    }));

    app.post('/api/clan/create', auth, route(async (req, res) => {
      const name = cleanName(req.body.name), tag = String(req.body.tag || '').trim().toUpperCase(), banner = req.body.banner;
      const joinMode = C.joinModes.includes(req.body.joinMode) ? req.body.joinMode : 'open';
      if (!/^[A-Za-z0-9 _-]{3,20}$/.test(name)) return err(res, 'Clan name: 3–20 letters, numbers, spaces, - or _.');
      if (!/^[A-Z0-9]{2,4}$/.test(tag)) return err(res, 'Clan tag: 2–4 letters or numbers.');
      if (/flipfight|admin|official/i.test(name + ' ' + tag)) return err(res, 'That name is reserved. Try another one.');
      if (!G.clanBannerOk(banner)) return err(res, 'Pick two different colours, a symbol and a pattern for the banner.');
      if (req.user.clan_id) return err(res, 'Leave your current clan first.');
      let id;
      try {
        id = await db.tx(async c => {
          const ok = (await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1 AND clan_id IS NULL', [C.createCost, req.user.id], c)).rowCount === 1;
          if (!ok) throw Object.assign(new Error(`Founding a clan costs ${C.createCost.toLocaleString('en-US')} FLIP.`), { user: true });
          const cl = await db.one(`INSERT INTO clans(name, tag, leader_id, banner, join_mode, created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
            [name, tag, req.user.id, JSON.stringify({ bg: banner.bg, fg: banner.fg, sym: banner.sym, pat: banner.pat }), joinMode, now()], c);
          await db.query('UPDATE users SET clan_id = $1 WHERE id = $2', [cl.id, req.user.id], c);
          await db.query('DELETE FROM clan_requests WHERE user_id = $1', [req.user.id], c);
          await db.addStat('burned', C.createCost, c);
          return cl.id;
        });
      } catch (e) {
        if (e.code === '23505') return err(res, /tag/.test(e.constraint || '') ? 'That tag is taken. Try another one.' : 'That clan name is taken. Try another one.', 409);
        if (e.user) return err(res, e.message);
        throw e;
      }
      await refresh(id);
      res.json({ ok: true, clanId: id });
    }));

    // join an open clan right away, or ask to join an approval clan
    app.post('/api/clan/join', auth, route(async (req, res) => {
      const id = Number(req.body.clanId), cl = cache.get(id);
      if (!cl) return err(res, 'That clan no longer exists.', 404);
      if (req.user.clan_id) return err(res, 'Leave your current clan first.');
      if (cl.joinMode === 'approval') {
        await db.query('INSERT INTO clan_requests(clan_id, user_id, created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id, req.user.id, now()]);
        return res.json({ ok: true, requested: true });
      }
      const msg = await db.tx(async c => addMember(id, req.user.id, c));
      if (msg) return err(res, msg);
      await refresh(id);
      res.json({ ok: true, joined: true });
    }));
    app.post('/api/clan/cancel-request', auth, route(async (req, res) => {
      await db.query('DELETE FROM clan_requests WHERE clan_id = $1 AND user_id = $2', [Number(req.body.clanId), req.user.id]);
      res.json({ ok: true });
    }));

    app.post('/api/clan/leave', auth, route(async (req, res) => {
      const id = req.user.clan_id, cl = cache.get(id);
      if (!cl) return err(res, 'You are not in a clan.');
      if (cl.leaderId === req.user.id && cl.members > 1) return err(res, 'Make another member the leader first, or disband the clan.');
      await db.tx(async c => {
        await db.query('UPDATE users SET clan_id = NULL WHERE id = $1', [req.user.id], c);
        if (cl.leaderId === req.user.id) await db.query('DELETE FROM clans WHERE id = $1', [id], c); // the last member closes the clan
      });
      await refresh(id); await refreshTop();
      res.json({ ok: true });
    }));

    // leader-only actions
    const leaderOf = (req, res) => {
      const cl = cache.get(req.user.clan_id);
      if (!cl || cl.leaderId !== req.user.id) { err(res, 'Only the clan leader can do that.', 403); return null; }
      return cl;
    };
    app.post('/api/clan/approve', auth, route(async (req, res) => {
      const cl = leaderOf(req, res); if (!cl) return;
      const uid = Number(req.body.userId);
      const has = await db.one('SELECT 1 FROM clan_requests WHERE clan_id = $1 AND user_id = $2', [cl.id, uid]);
      if (!has) return err(res, 'That request is gone.');
      const msg = await db.tx(async c => addMember(cl.id, uid, c));
      if (msg) { await db.query('DELETE FROM clan_requests WHERE clan_id = $1 AND user_id = $2', [cl.id, uid]); return err(res, msg); }
      await refresh(cl.id);
      res.json({ ok: true });
    }));
    app.post('/api/clan/reject', auth, route(async (req, res) => {
      const cl = leaderOf(req, res); if (!cl) return;
      await db.query('DELETE FROM clan_requests WHERE clan_id = $1 AND user_id = $2', [cl.id, Number(req.body.userId)]);
      res.json({ ok: true });
    }));
    app.post('/api/clan/kick', auth, route(async (req, res) => {
      const cl = leaderOf(req, res); if (!cl) return;
      const uid = Number(req.body.userId);
      if (uid === req.user.id) return err(res, 'You can\'t kick yourself. Leave or disband instead.');
      const r = await db.query('UPDATE users SET clan_id = NULL WHERE id = $1 AND clan_id = $2', [uid, cl.id]);
      if (!r.rowCount) return err(res, 'That player is not in your clan.');
      await refresh(cl.id);
      res.json({ ok: true });
    }));
    app.post('/api/clan/transfer', auth, route(async (req, res) => {
      const cl = leaderOf(req, res); if (!cl) return;
      const uid = Number(req.body.userId);
      const m = await db.one('SELECT id FROM users WHERE id = $1 AND clan_id = $2', [uid, cl.id]);
      if (!m || uid === req.user.id) return err(res, 'Pick another member of your clan.');
      await db.query('UPDATE clans SET leader_id = $1 WHERE id = $2', [uid, cl.id]);
      await refresh(cl.id);
      res.json({ ok: true });
    }));
    app.post('/api/clan/update', auth, route(async (req, res) => {
      const cl = leaderOf(req, res); if (!cl) return;
      const banner = req.body.banner, joinMode = req.body.joinMode;
      if (banner !== undefined && !G.clanBannerOk(banner)) return err(res, 'Pick two different colours, a symbol and a pattern for the banner.');
      if (joinMode !== undefined && !C.joinModes.includes(joinMode)) return err(res, 'Unknown join mode.');
      await db.query('UPDATE clans SET banner = COALESCE($1, banner), join_mode = COALESCE($2, join_mode) WHERE id = $3',
        [banner ? JSON.stringify({ bg: banner.bg, fg: banner.fg, sym: banner.sym, pat: banner.pat }) : null, joinMode || null, cl.id]);
      if (joinMode === 'open') { // opening the doors lets everyone who asked in, while there is room
        for (const r of await db.all('SELECT user_id FROM clan_requests WHERE clan_id = $1 ORDER BY created_at', [cl.id])) await db.tx(async c => addMember(cl.id, r.user_id, c));
      }
      await refresh(cl.id);
      res.json({ ok: true });
    }));
    app.post('/api/clan/disband', auth, route(async (req, res) => {
      const cl = leaderOf(req, res); if (!cl) return;
      await db.tx(async c => {
        await db.query('UPDATE users SET clan_id = NULL WHERE clan_id = $1', [cl.id], c);
        await db.query('DELETE FROM clans WHERE id = $1', [cl.id], c);
      });
      await refresh(cl.id); await refreshTop();
      res.json({ ok: true });
    }));
  }

  // adds a member if there is room (locks the clan row so two joins can't overfill it); returns an error or null
  async function addMember(clanId, userId, c) {
    const cl = await db.one('SELECT id FROM clans WHERE id = $1 FOR UPDATE', [clanId], c);
    if (!cl) return 'That clan no longer exists.';
    const n = Number((await db.one('SELECT COUNT(*) AS n FROM users WHERE clan_id = $1', [clanId], c)).n);
    if (n >= C.maxMembers) return `This clan is full (${C.maxMembers} members).`;
    const r = await db.query('UPDATE users SET clan_id = $1 WHERE id = $2 AND clan_id IS NULL', [clanId, userId], c);
    if (!r.rowCount) return 'That player already joined another clan.';
    await db.query('DELETE FROM clan_requests WHERE user_id = $1', [userId], c);
    return null;
  }

  return { load, register, clanOf, onWin, seasonReset, afterSeasonReset, topClan };
}

module.exports = { createClans };
