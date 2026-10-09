export const orderTypeOf = product => product?.orderType || '陪玩单';
export const productNeedsLevel = product => !['趣味单', '护航单'].includes(orderTypeOf(product));
export const orderHasLevel = order => order?.levelRequired !== false;
export const productGuarantee = product => orderTypeOf(product) === '护航单' ? product?.guarantee || '' : '';

export function productUnitPrice(product, levelId, gameLevelConfigs, levels = []) {
  if (!product) return undefined;
  if (!productNeedsLevel(product) || product.pricingMode === 'fixed') return product.priceCents;
  const gamePrice = gameLevelConfigs?.[product.game]?.levels?.find(item => item.id === levelId)?.priceCents;
  const levelPrice = levels.find(item => item.id === levelId)?.priceCents;
  const base = Number.isSafeInteger(gamePrice) ? gamePrice : product.game === '三角洲行动' ? levelPrice : product.priceCents;
  const count = product.escortCount || (product.game === '三角洲行动' && product.name === '2陪1' ? 2 : 1);
  return Number.isSafeInteger(base) ? base * (product.pricingMode === 'level' || product.game === '三角洲行动' ? count : 1) : undefined;
}

export function productStartingPrice(product, gameLevelConfigs, levels = []) {
  if (product && (!productNeedsLevel(product) || product.pricingMode === 'fixed')) return product.priceCents;
  const choices = gameLevelConfigs?.[product?.game]?.levels?.length ? gameLevelConfigs[product.game].levels : levels;
  const prices = choices.map(level => productUnitPrice(product, level.id, gameLevelConfigs, levels)).filter(price => Number.isSafeInteger(price) && price > 0);
  return prices.length ? Math.min(...prices) : undefined;
}

export const productEscortCount = product => product?.escortCount || (product?.game === '三角洲行动' && product?.name === '2陪1' ? 2 : 1);
