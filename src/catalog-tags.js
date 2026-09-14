// Use the same current products shown by the special-order configuration.
// Paused services remain configured; historical order tags are not options.
export function catalogTags(products = [], game = '') {
  return [...new Set(products
    .filter(product => (!game || product.game === game) && typeof product.name === 'string' && product.name.trim())
    .map(product => product.name.trim()))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
