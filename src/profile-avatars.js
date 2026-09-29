// Original vector illustrations created for the Star River club.
export const profileAvatars = [
  ['star', '星星队长'], ['planet', '环游星球'], ['moon', '月亮搭子'],
  ['comet', '追光彗星'], ['rocket', '开局火箭'], ['bot', '信号小队'],
  ['cloud', '云端玩家'], ['crystal', '能量水晶'], ['satellite', '巡航卫星'],
  ['orbit', '轨道精灵'],
].map(([id, name]) => ({ src: `/src/profile-avatar-${id}.svg`, name }));

export const isProfileAvatarPreset = value => profileAvatars.some(avatar => avatar.src === value);
