const escorts = [
  { name: '米粒', initials: '米', tone: 'purple', state: '在线', games: '王者荣耀 · 和平精英', hourly: '¥ 68 / 小时', share: '70%', rating: '4.9', orders: 42, balance: '¥ 8,460' },
  { name: '小满', initials: '小', tone: 'orange', state: '陪玩中', games: '英雄联盟 · 王者荣耀', hourly: '¥ 88 / 小时', share: '72%', rating: '4.8', orders: 36, balance: '¥ 6,820' },
  { name: '阿九', initials: '阿', tone: 'green', state: '在线', games: '无畏契约 · Apex', hourly: '¥ 78 / 小时', share: '68%', rating: '4.7', orders: 29, balance: '¥ 5,240' },
  { name: '七喜', initials: '七', tone: 'navy', state: '离线', games: '和平精英 · 永劫无间', hourly: '¥ 58 / 小时', share: '65%', rating: '4.6', orders: 18, balance: '¥ 3,180' },
  { name: '桃桃', initials: '桃', tone: 'pink', state: '待审核', games: '王者荣耀 · 金铲铲之战', hourly: '¥ 62 / 小时', share: '—', rating: '—', orders: 0, balance: '¥ 0' },
];

const orders = [
  { id: 'PO20240618031', status: '陪玩中', boss: '林先生', escort: '米粒 / 小满', game: '王者荣耀', product: '排位赛陪玩', quantity: '2 小时', amount: '¥ 136', pay: '余额支付', time: '今天 10:24', tone: 'purple' },
  { id: 'PO20240618027', status: '待接单', boss: '周致远', escort: '待分配', game: '无畏契约', product: '竞技上分', quantity: '3 小时', amount: '¥ 294', pay: '微信支付', time: '今天 10:12', tone: 'orange' },
  { id: 'PO20240618019', status: '已完成', boss: '陈思齐', escort: '阿九', game: 'Apex', product: '娱乐陪玩', quantity: '1 小时', amount: '¥ 78', pay: '余额支付', time: '今天 09:48', tone: 'green' },
  { id: 'PO20240617092', status: '待结算', boss: '沈嘉禾', escort: '小满', game: '英雄联盟', product: '双排陪玩', quantity: '4 小时', amount: '¥ 352', pay: '余额支付', time: '昨天 22:16', tone: 'navy' },
  { id: 'PO20240617071', status: '退款审核', boss: '许清欢', escort: '七喜', game: '和平精英', product: '开黑陪玩', quantity: '2 小时', amount: '¥ 116', pay: '余额支付', time: '昨天 20:42', tone: 'pink' },
];

const games = [
  { name: '王者荣耀', category: 'MOBA', multiplier: '1.00x', min: 1, max: 5, escorts: 36, state: '上架', tone: 'purple' },
  { name: '无畏契约', category: 'FPS', multiplier: '1.10x', min: 1, max: 4, escorts: 18, state: '上架', tone: 'orange' },
  { name: '和平精英', category: '射击竞技', multiplier: '0.95x', min: 1, max: 3, escorts: 24, state: '上架', tone: 'green' },
  { name: '英雄联盟', category: 'MOBA', multiplier: '1.05x', min: 1, max: 5, escorts: 22, state: '维护', tone: 'navy' },
];

const products = [
  { name: '排位赛陪玩', game: '王者荣耀', unit: '小时', price: '¥ 68', note: '默认商品 · 需选择 1-5 名陪玩', state: '启用', tone: 'purple' },
  { name: '竞技上分', game: '无畏契约', unit: '小时', price: '¥ 98', note: '高峰时段自动加价 10%', state: '启用', tone: 'orange' },
  { name: '开黑陪玩', game: '和平精英', unit: '小时', price: '¥ 58', note: '最多 3 名陪玩同时接单', state: '启用', tone: 'green' },
  { name: '双排陪玩', game: '英雄联盟', unit: '小时', price: '¥ 88', note: '游戏维护中，暂不可下单', state: '暂停', tone: 'navy' },
];

const topups = [
  { id: 'CZ20240618012', user: '周致远', amount: '¥ 2,000', before: '¥ 460', after: '¥ 2,460', state: '待审核', time: '今天 09:18', proof: '待核验' },
  { id: 'CZ20240617028', user: '林若安', amount: '¥ 5,000', before: '¥ 2,180', after: '¥ 7,180', state: '已通过', time: '昨天 18:31', proof: '已核验' },
  { id: 'CZ20240616019', user: '沈嘉禾', amount: '¥ 2,000', before: '¥ 320', after: '¥ 2,320', state: '待审核', time: '06/16 14:20', proof: '待核验' },
  { id: 'CZ20240615007', user: '许清欢', amount: '¥ 500', before: '¥ 80', after: '¥ 580', state: '已驳回', time: '06/15 11:08', proof: '金额不符' },
];

const flows = [
  { id: 'FL20240618045', type: '增加', account: '林若安 · 余额', amount: '+ ¥ 136', after: '¥ 3,820', source: '陪玩订单 PO20240618031', operator: '系统', state: '已入账', time: '10:24' },
  { id: 'FL20240618032', type: '减少', account: '米粒 · 待提现', amount: '− ¥ 95.20', after: '¥ 8,460', source: '陪玩分成', operator: '系统', state: '已入账', time: '10:24' },
  { id: 'FL20240618018', type: '增加', account: '周致远 · 余额', amount: '+ ¥ 2,000', after: '¥ 2,460', source: '充值 CZ20240618012', operator: '杨澄', state: '待审核', time: '09:18' },
  { id: 'FL20240617077', type: '减少', account: '俱乐部 · 结算账户', amount: '− ¥ 18,640', after: '¥ 241,380', source: '结算批次 #2406-1', operator: '杨澄', state: '已完成', time: '昨天 16:42' },
  { id: 'FL20240617041', type: '设置为', account: '阿九 · 押金', amount: '¥ 1,000', after: '¥ 1,000', source: '押金调整', operator: '杨澄', state: '已入账', time: '昨天 14:06' },
];

const settlements = [
  { id: '#2406-2', period: '06/10 — 06/16', escorts: 18, amount: '¥ 36,280', state: '待复核', created: '今天 09:00' },
  { id: '#2406-1', period: '06/03 — 06/09', escorts: 21, amount: '¥ 42,680', state: '已完成', created: '06/10 16:42' },
  { id: '#2405-4', period: '05/27 — 06/02', escorts: 20, amount: '¥ 38,920', state: '已完成', created: '06/03 15:18' },
];


const conversations = [
  { boss: '林先生', last: '今晚还可以加一位陪玩吗？', time: '10:31', unread: 2, channel: '微信', state: '待回复' },
  { boss: '周致远', last: '想约无畏契约三小时，能安排吗？', time: '10:18', unread: 1, channel: '站内信', state: '待回复' },
  { boss: '沈嘉禾', type: 'support', last: '昨天的订单可以申请部分退款吗', time: '09:52', unread: 0, channel: '微信', state: '处理中' },
  { boss: '陈思齐', last: '已收到，谢谢安排', time: '昨天 21:06', unread: 0, channel: '站内信', state: '已结束' },
];

// Sample records used by the examiner workspace. Runtime IDs are attached by the store.
const assessments = [
  { id: 'EX20240618001', member: '米粒', type: '质检', game: '王者荣耀', score: 92, result: '通过', wins: 9, losses: 1, kills: 18, deaths: 4, mvp: 3, note: '近期服务稳定，保持当前等级。' },
  { id: 'EX20240618002', member: '桃桃', type: '入店考核', game: '王者荣耀', score: null, result: null, wins: null, losses: null, kills: null, deaths: null, mvp: null, note: '' },
];

export { escorts, orders, games, products, topups, flows, settlements, conversations, assessments };
