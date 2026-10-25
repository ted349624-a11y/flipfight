// Weekly world boss: shared HP, 15 fights a day per player, rewards when it falls.
// The boss of a week belongs to the current season (same start and end).
function createBoss({ db, G, io, seasons, clanOf = () => null, now = () => Date.now() }) {
  const B = G.BOSS;
  const hpOf = b => b.hp || Number(process.env.BOSS_HP) || B.hp;
  let cur = null; // { season, boss, maxHp, hp, killedAt, endsAt }
  const day = (t = now()) => new Date(t).toISOString().slice(0, 10);

  // B.startNow: put that boss in place of the current week's boss, once (remembered in kv)
  let forced = !B.startNow;
  async function forceStart(season) {
    if (forced) return;
    forced = true;
    const S = typeof B.startNow === 'string' ? { id: B.startNow, key: B.startNow } : B.startNow;
    const b = B.bosses.find(x => x.id === S.id);
    if (!b) return;
    await db.tx(async c => {
      const r = await db.query('INSERT INTO kv(key, value) VALUES($1, $2) ON CONFLICT(key) DO NOTHING', ['boss-now:' + S.key, season.number], c);
      if (!r.rowCount) return;
      await db.query(`INSERT INTO bosses(season, boss, max_hp, hp) VALUES($1,$2,$3,$3)
        ON CONFLICT (season) DO UPDATE SET boss = EXCLUDED.boss, max_hp = EXCLUDED.max_hp, hp = EXCLUDED.hp, killed_at = NULL, killer_id = NULL`, [season.number, b.id, hpOf(b)], c);
      await db.query('DELETE FROM boss_hits WHERE season = $1', [season.number], c);
      await db.query('DELETE FROM boss_attempts WHERE day = $1', [day()], c);
      console.log(`boss: ${b.name} (${hpOf(b)} HP) now in place for season ${season.number}`);
    });
  }

  async function load() {
    const season = seasons.current() || await seasons.load();
    await forceStart(season);
    let row = await db.one('SELECT * FROM bosses WHERE season = $1', [season.number]);
    if (!row) row = await db.one(`INSERT INTO bosses(season, boss, max_hp, hp) VALUES($1,$2,$3,$3) ON CONFLICT (season) DO UPDATE SET season = EXCLUDED.season RETURNING *`,
      [season.number, G.bossOf(season.number).id, hpOf(G.bossOf(season.number))]);
    cur = { season: row.season, boss: G.BOSS.bosses.find(b => b.id === row.boss) || G.bossOf(row.season), maxHp: Number(row.max_hp), hp: Number(row.hp),
      killedAt: row.killed_at ? Number(row.killed_at) : null, endsAt: Number(season.ends_at) };
    return cur;
  }
  const state = () => cur && { season: cur.season, id: cur.boss.id, name: cur.boss.name, el: cur.boss.el, spot: cur.boss.spot || 'sea', maxHp: cur.maxHp, hp: cur.hp, killedAt: cur.killedAt, endsAt: cur.endsAt };
  const broadcast = () => io.to('w:boss').to('island').emit('boss:update', state()); // only the boss screen and the island show it

  async function attemptsUsed(userId) {
    const r = await db.one('SELECT n FROM boss_attempts WHERE user_id = $1 AND day = $2', [userId, day()]);
    return r ? r.n : 0;
  }
  // takes one of today's fights, or throws
  async function useAttempt(userId) {
    await load();
    if (cur.killedAt) throw new Error(`${cur.boss.name} has already fallen this week. A new boss comes with the next season.`);
    const r = await db.one(`INSERT INTO boss_attempts(user_id, day, n) VALUES($1,$2,1)
      ON CONFLICT (user_id, day) DO UPDATE SET n = boss_attempts.n + 1 WHERE boss_attempts.n < $3 RETURNING n`, [userId, day(), B.fightsPerDay]);
    if (!r) throw new Error(`You used all ${B.fightsPerDay} boss fights for today. Come back tomorrow (UTC).`);
    return cur;
  }

  // apply a finished fight; pays out if this hit fells the boss
  async function recordFight(userId, damage) {
    let result = null;
    await db.tx(async c => {
      const row = await db.one('SELECT * FROM bosses WHERE season = $1 FOR UPDATE', [cur.season], c);
      if (!row) return;
      const before = Number(row.hp), dealt = row.killed_at ? 0 : Math.min(before, damage);
      await db.query(`INSERT INTO boss_hits(season, user_id, damage, fights, best) VALUES($1,$2,$3,1,$4)
        ON CONFLICT (season, user_id) DO UPDATE SET damage = boss_hits.damage + $3, fights = boss_hits.fights + 1, best = GREATEST(boss_hits.best, $4)`,
        [row.season, userId, dealt, damage], c);
      const hp = before - dealt;
      let killed = false, rewards = null;
      if (!row.killed_at && hp <= 0) {
        killed = true;
        await db.query('UPDATE bosses SET hp = 0, killed_at = $1, killer_id = $2 WHERE season = $3', [now(), userId, row.season], c);
        rewards = await payOut(row, c);
      } else if (dealt) await db.query('UPDATE bosses SET hp = $1 WHERE season = $2', [hp, row.season], c);
      result = { damage, dealt, hp: Math.max(0, hp), maxHp: Number(row.max_hp), killed, finalBlow: killed, rewards };
    });
    await load();
    broadcast();
    return result;
  }
  async function payOut(row, c) {
    const hitters = await db.all('SELECT user_id, damage FROM boss_hits WHERE season = $1 AND damage > 0 ORDER BY damage DESC, user_id ASC', [row.season], c);
    for (let i = 0; i < hitters.length; i++) {
      const extra = B.rewards.top[i] || 0, pay = B.rewards.all + extra;
      await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [pay, hitters[i].user_id], c);
      if (i < B.rewards.top.length) await db.query('INSERT INTO boss_badges(season, user_id, place, boss) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [row.season, hitters[i].user_id, i + 1, row.boss], c);
    }
    await db.addStat('boss_rewards_paid', hitters.length * B.rewards.all + B.rewards.top.slice(0, hitters.length).reduce((a, x) => a + x, 0), c);
    return { players: hitters.length };
  }

  function register(app, { auth, route }) {
    app.get('/api/boss', auth, route(async (req, res) => {
      await load();
      const top = await db.all(`SELECT h.user_id AS id, u.nickname, u.clan_id, h.damage, h.fights FROM boss_hits h JOIN users u ON u.id = h.user_id
        WHERE h.season = $1 AND h.damage > 0 ORDER BY h.damage DESC, h.user_id ASC LIMIT 10`, [cur.season]);
      const mine = await db.one('SELECT damage, fights, best FROM boss_hits WHERE season = $1 AND user_id = $2', [cur.season, req.user.id]);
      const total = await db.one('SELECT COUNT(*)::int AS n FROM boss_hits WHERE season = $1 AND damage > 0', [cur.season]);
      res.json({ boss: state(), deck: G.bossDeck(cur.boss), top: top.map(r => ({ id: r.id, nickname: r.nickname, clan: clanOf(r.clan_id), damage: Number(r.damage), fights: r.fights })), me: { damage: mine ? Number(mine.damage) : 0, fights: mine ? mine.fights : 0, best: mine ? Number(mine.best) : 0,
        attemptsLeft: Math.max(0, B.fightsPerDay - await attemptsUsed(req.user.id)) }, hitters: total.n, rules: { fightsPerDay: B.fightsPerDay, damage: B.damage, rewards: B.rewards }, serverNow: now() });
    }));
  }

  return { load, state, useAttempt, recordFight, register, broadcast };
}

module.exports = { createBoss };
