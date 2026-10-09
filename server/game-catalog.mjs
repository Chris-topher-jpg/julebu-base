// Only this collection supplies active game choices. Legacy games remain available
// to historical orders without becoming selectable again.
export const catalogList = data => data.catalogGames || (data.catalogGames = (data.games || []).filter(game => game.name === '三角洲行动'));
export const catalogNames = data => new Set(catalogList(data).map(game => game.name));
export const visibleProducts = data => {
  const names = catalogNames(data);
  return (data.products || []).filter(product => names.has(product.game));
};
