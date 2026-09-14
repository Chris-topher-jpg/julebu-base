// Explicitly approve a test account through the public store workflow.
// No test setup should globally mark all seeded users as verified.
const NAMES = ['张三', '李四', '王五', '赵六', '钱七'];
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK = '10X98765432';
function fixtureId(sequence) {
  const base = `11010519491231${String(100 + sequence).padStart(3, '0')}`;
  return base + CHECK[WEIGHTS.reduce((sum, weight, index) => sum + Number(base[index]) * weight, 0) % 11];
}

let identityIndex = 0;

export function verifyFixtureUser(store, user, options = {}) {
  const sequence = identityIndex++;
  const defaultName = NAMES[sequence % NAMES.length];
  const defaultId = fixtureId(sequence % 80);
  const submitted = store.submitRealName(user, {
    consent: true,
    realName: options.realName || defaultName,
    idNumber: options.idNumber || defaultId,
  });
  const reviewed = store.reviewRealName(
    { id: 'admin' },
    submitted.requestId,
    { action: 'approve', version: submitted.version, documentsChecked: true, reviewNote: options.reviewNote || '测试身份核验通过' },
  );
  return reviewed;
}

export function userById(store, id) {
  const user = store.read().users.find(item => item.id === id);
  if (!user) throw new Error(`Missing fixture user: ${id}`);
  return user;
}
