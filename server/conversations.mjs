// Persist the purpose of a conversation. Linking an order or mentioning a
// refund later must not move an explicitly classified chat between teams.
export function conversationType(chat) {
  if (['support', 'consultation'].includes(chat.type)) return chat.type;
  // Older after-sales contacts had no type, but used the online support
  // channel or an order without a companion as their target.
  return chat.channel === '在线客服' || ['在线客服', '售后服务'].includes(chat.escortName) || (chat.orderId && !chat.escortId)
    ? 'support' : 'consultation';
}

export function canManageConversation(user, chat) {
  return user.role === 'admin'
    || user.role === (conversationType(chat) === 'support' ? 'afterSales' : 'service')
    || user.role === 'escort' && conversationType(chat) === 'consultation' && chat.escortId === user.id;
}

export const escortUnread = chat => chat.escortUnread ?? (chat.messages || []).filter(message => message.authorId !== chat.escortId).length;

// Escorts participate in the conversation, but do not receive customer login
// details, staff follow-ups, financial records or other management metadata.
export function escortConversation(chat) {
  return {
    id: chat.id, type: conversationType(chat), escortId: chat.escortId,
    escortName: chat.escortName || '', boss: chat.boss || '',
    channel: chat.channel, state: chat.state, last: chat.last,
    unread: escortUnread(chat), createdAt: chat.createdAt, updatedAt: chat.updatedAt,
    peer: { name: chat.boss || '客户' },
    messages: (chat.messages || []).map(({ text, author, authorId, at }) => ({ text, author, authorId, at })),
  };
}
