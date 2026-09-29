import { createHash, randomBytes, randomUUID } from 'node:crypto';

const statuses = new Set(['unverified', 'pending', 'verified', 'rejected']);
const fail = (condition, message, status = 400) => {
  if (!condition) throw Object.assign(new Error(message), { status });
};

export function realNameVerification(user) {
  const record = user?.realNameVerification;
  return {
    status: statuses.has(record?.status) ? record.status : 'unverified',
    requestId: record?.requestId || null,
    maskedName: record?.maskedName || '',
    maskedIdNumber: record?.maskedIdNumber || '',
    submittedAt: record?.submittedAt || null,
    reviewedAt: record?.reviewedAt || null,
    rejectionReason: record?.rejectionReason || '',
    version: Number.isSafeInteger(record?.version) ? record.version : 0,
  };
}

export const isRealNameVerified = user => user?.realNameVerification?.status === 'verified';

export function requireRealName(user) {
  fail(isRealNameVerified(user), '请先完成实名认证并等待审核通过', 403);
}

export function migrateRealName(data) {
  let changed = false;
  if (!Array.isArray(data.realNameRequests)) { data.realNameRequests = []; changed = true; }
  for (const user of data.users) {
    if (!statuses.has(user.realNameVerification?.status)) {
      user.realNameVerification = realNameVerification();
      changed = true;
    }
    if (user.role === 'escort' && !isRealNameVerified(user) && user.online) {
      user.online = false;
      changed = true;
    }
  }
  return changed;
}

function validateIdentity(input) {
  fail(input?.consent === true, '请同意用于实名认证的个人信息处理');
  fail(typeof input.realName === 'string', '请输入真实姓名');
  const realName = input.realName.trim().normalize('NFC');
  fail(realName.length >= 2 && realName.length <= 60 && /^[\p{L}\p{M}][\p{L}\p{M} \u00b7.'-]*[\p{L}\p{M}]$/u.test(realName), '请输入有效的真实姓名');
  fail(typeof input.idNumber === 'string', '请输入 18 位居民身份证号码');
  const idNumber = input.idNumber.trim().toUpperCase();
  fail(/^[1-9]\d{16}[\dX]$/.test(idNumber), '请输入 18 位居民身份证号码');
  const provinces = new Set(['11','12','13','14','15','21','22','23','31','32','33','34','35','36','37','41','42','43','44','45','46','50','51','52','53','54','61','62','63','64','65','71','81','82']);
  fail(provinces.has(idNumber.slice(0, 2)) && idNumber.slice(14, 17) !== '000', '身份证号码格式无效');
  const year = Number(idNumber.slice(6, 10));
  const month = Number(idNumber.slice(10, 12));
  const day = Number(idNumber.slice(12, 14));
  const birthday = new Date(Date.UTC(year, month - 1, day));
  fail(year >= 1900 && birthday.getUTCFullYear() === year && birthday.getUTCMonth() === month - 1 && birthday.getUTCDate() === day && birthday.getTime() <= Date.now(), '身份证出生日期无效');
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checksum = '10X98765432'[weights.reduce((sum, weight, index) => sum + Number(idNumber[index]) * weight, 0) % 11];
  fail(checksum === idNumber[17], '身份证号码校验码无效，请核对后重试');
  return { realName, idNumber };
}

export function submitRealName(data, user, input) {
  const previous = realNameVerification(user);
  fail(!['pending', 'verified'].includes(previous.status), previous.status === 'pending' ? '实名认证正在审核，请勿重复提交' : '已完成实名认证，无需重复提交', 409);
  const { realName, idNumber } = validateIdentity(input);
  const requestId = `RN${randomUUID()}`;
  const salt = randomBytes(32).toString('hex');
  const state = {
    status: 'pending', requestId, maskedName: `${Array.from(realName)[0]}${'*'.repeat(Math.min(Array.from(realName).length - 1, 6))}`,
    maskedIdNumber: `${idNumber.slice(0, 3)}***********${idNumber.slice(-4)}`,
    submittedAt: new Date().toISOString(), reviewedAt: null, rejectionReason: '', version: previous.version + 1,
  };
  // Formatting checks do not establish identity. Store only a salted digest of
  // the document number; approval requires a separate manual verification.
  (data.realNameRequests ||= []).unshift({ ...state, userId: user.id, realName, idNumberDigest: createHash('sha256').update(`${salt}:${idNumber}`).digest('hex'), digestSalt: salt, consentAt: state.submittedAt });
  user.realNameVerification = state;
  if (user.role === 'escort') user.online = false;
  return realNameVerification(user);
}

export function realNameRequests(data) {
  return (data.realNameRequests || []).map(record => {
    const user = data.users.find(candidate => candidate.id === record.userId);
    return { ...realNameVerification({ realNameVerification: record }), userId: record.userId, username: user?.username || '', name: user?.name || '', memberNo: user?.memberNo || '', reviewNote: record.reviewNote || '' };
  });
}

export function reviewRealName(data, actor, requestId, input) {
  fail(actor.role === 'admin', '只有最高负责人可以审核实名认证', 403);
  const request = (data.realNameRequests || []).find(record => record.requestId === requestId);
  fail(request, '实名认证申请不存在', 404);
  fail(request.userId !== actor.id, '不能审核自己的实名认证申请', 403);
  const user = data.users.find(candidate => candidate.id === request.userId);
  fail(user, '申请用户不存在', 404);
  fail(request.status === 'pending' && user.realNameVerification?.requestId === requestId && user.realNameVerification?.status === 'pending' && input.version === request.version && input.version === user.realNameVerification.version, '实名认证申请已更新，请刷新后重试', 409);
  fail(['approve', 'reject'].includes(input.action), '审核动作无效');
  if (input.action === 'approve') fail(input.documentsChecked === true, '请确认已完成人工身份核验');
  const suppliedNote = input.reviewNote ?? input.reason;
  fail(typeof suppliedNote === 'string' && suppliedNote.trim().length > 0 && suppliedNote.trim().length <= 300, input.action === 'approve' ? '请填写人工身份核验说明（最多 300 字）' : '请填写驳回原因（最多 300 字）');
  const reviewNote = suppliedNote.trim();
  Object.assign(request, { status: input.action === 'approve' ? 'verified' : 'rejected', reviewedAt: new Date().toISOString(), reviewedBy: actor.id, reviewNote, rejectionReason: input.action === 'reject' ? reviewNote : '', version: request.version + 1 });
  user.realNameVerification = realNameVerification({ realNameVerification: request });
  return realNameVerification(user);
}
