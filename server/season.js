// Weekly seasons: keeps exactly one open season, and when it ends pays the top 100,
// records the results (top 3 = permanent badges), resets ratings halfway to 1200 and opens the next one.
function createSeasons({ db, G, io }) {
  const S = G.SEASON;
  let current = null;

  async function load() {
    current = await db.one('SELECT * FROM seasons WHERE finalized_at IS NULL ORDER BY number DESC LIMIT 1');
    if (!current) {
      const last = await db.one('SELECT * FROM seasons ORDER BY number DESC LIMIT 1');
      const start = last ? Number(last.ends_at) : Date.now();
      current = await db.one('INSERT INTO seasons(number, starts_at, ends_at) VALUES($1,$2,$3) ON CONFLICT (number) DO UPDATE SET number = EXCLUDED.number RETURNING *',
        [last ? last.number + 1 : 1, start, start + S.lengthMs]);
    }
    return current;
  }

  // Final standings: qualified players ordered by rating, then season wins, then who joined first.
  const STANDINGS = `SELECT id, nickname, elo, season_played, season_wins, season_losses, season_draws FROM users
                     WHERE nickname IS NOT NULL AND season_played >= $1 ORDER BY elo DESC, season_wins DESC, id ASC`;

  async function finalize(season) {
    let paid = [];
    await db.tx(async c => {
      // lock the season row so a second server instance can't pay twice
      const row = await db.one('SELECT * FROM seasons WHERE number = $1 AND finalized_at IS NULL FOR UPDATE', [season.number], c);
      if (!row) return;
      const standings = await db.all(STANDINGS, [S.minMatches], c);
      for (let i = 0; i < standings.length; i++) {
        const u = standings[i], place = i + 1, reward = G.seasonReward(place);
        await db.query(`INSERT INTO season_results(season, user_id, place, elo, wins, losses, draws, reward) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [row.number, u.id, place, u.elo, u.season_wins, u.season_losses, u.season_draws, reward], c);
        if (reward > 0) { await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [reward, u.id], c); paid.push({ id: u.id, place, reward }); }
      }
      await db.addStat('season_rewards_paid', paid.reduce((a, p) => a + p.reward, 0), c);
      // soft reset for everyone, and fresh season stats
      await db.query(`UPDATE users SET elo = ROUND($1::numeric + (elo - $1::numeric) * $2::numeric)::int, season_played = 0, season_wins = 0, season_losses = 0, season_draws = 0`, [S.resetTo, S.resetKeep], c);
      await db.query('UPDATE seasons SET finalized_at = $1 WHERE number = $2', [Date.now(), row.number], c);
      await db.query('INSERT INTO seasons(number, starts_at, ends_at) VALUES($1,$2,$3) ON CONFLICT (number) DO NOTHING',
        [row.number + 1, Number(row.ends_at), Number(row.ends_at) + S.lengthMs], c);
    });
    console.log(`Season ${season.number} finalized: ${paid.length} players paid.`);
    await load();
    io.emit('season:ended', { season: season.number, next: current.number });
  }

  // Runs every minute and on boot; catches up if the server slept through one or more season ends.
  async function tick() {
    await load();
    let guard = 0;
    while (Date.now() >= Number(current.ends_at) && guard++ < 520) await finalize(current);
  }

  function start() {
    tick().catch(e => console.error('season tick', e));
    setInterval(() => tick().catch(e => console.error('season tick', e)), 60 * 1000).unref();
  }

  return { start, tick, finalize, current: () => current, load, STANDINGS };
}

module.exports = { createSeasons };
