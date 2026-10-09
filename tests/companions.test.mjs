import test from 'node:test';
import assert from 'node:assert/strict';
import { companionProfiles, findCompanionProfile } from '../src/companions.js';

const catalog = {
  catalogGames: [{ name: '三角洲行动', state: '上架' }, { name: '王者荣耀', state: '上架' }],
  levels: [{ id: 'gold', name: '金牌', rank: 1, priceCents: 6000 }],
  gameLevelConfigs: { '三角洲行动': { levels: [{ id: 'gold', priceCents: 6825 }] }, '王者荣耀': { levels: [{ id: 'gold', priceCents: 4150 }] } },
};
const member = { id: 'escort-1', memberNo: '810001', name: '真实陪玩', games: ['三角洲行动', '王者荣耀'], levelId: 'gold', online: true, bio: '本人简介' };

test('登录个人目录展开 games 数组并保留真实身份、等级和分位价格', () => {
  const profiles = companionProfiles({ ...catalog, members: [member] });
  assert.equal(profiles.length, 2);
  assert.deepEqual(profiles.map(({ escortId, game, levelId, level, price }) => ({ escortId, game, levelId, level, price })), [
    { escortId: member.id, game: '三角洲行动', levelId: 'gold', level: '金牌', price: 68.25 },
    { escortId: member.id, game: '王者荣耀', levelId: 'gold', level: '金牌', price: 41.5 },
  ]);
  assert.equal(profiles[0].number, member.memberNo);
  assert.equal(profiles[0].bio, member.bio);
});

test('游客单游戏目录与登录后目录使用一致 ID，未知统计不伪造为好评或服务量', () => {
  const publicProfile = companionProfiles({ ...catalog, members: [{ ...member, games: undefined, game: '三角洲行动', priceCents: 1000 }] })[0];
  const personalProfile = companionProfiles({ ...catalog, members: [member] })[0];
  assert.equal(publicProfile.id, personalProfile.id);
  assert.equal(publicProfile.price, 68.25);
  assert.equal(publicProfile.rating, null);
  assert.equal(publicProfile.orders, null);
  assert.deepEqual(companionProfiles(catalog), []);
});

test('同名陪玩按账户 ID 和游戏定位，停用、冻结、下架和未知定价正确处理', () => {
  const workspace = { ...catalog, members: [member, { ...member, id: 'escort-2' }, { ...member, id: 'disabled', active: false }, { ...member, id: 'frozen', escortFrozen: true }] };
  assert.equal(findCompanionProfile('escort-2', workspace, '王者荣耀').escortId, 'escort-2');
  assert.equal(companionProfiles(workspace).length, 4);
  assert.deepEqual(companionProfiles({ catalogGames: [{ name: '三角洲行动', state: '下架' }], members: [member] }), []);
  assert.equal(companionProfiles({ catalogGames: catalog.catalogGames, members: [member] })[0].price, null);
});
