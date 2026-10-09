import assert from 'node:assert/strict';

// Historical sample games are opt-in fixtures, not the club's default catalog.
export function addFixtureGames(store, names) {
  const snapshot = store.read();
  const missing = names.filter(name => !snapshot.catalogGames.some(game => game.name === name));
  if (!missing.length) return;
  const admin = snapshot.users.find(user => user.id === 'admin');
  store.transaction(admin, 'account:manage', 'Configure test catalog', data => {
    for (const name of missing) {
      const game = data.games.find(item => item.name === name);
      assert.ok(game, `Missing fixture game: ${name}`);
      data.catalogGames.push({ ...game });
    }
  });
}
