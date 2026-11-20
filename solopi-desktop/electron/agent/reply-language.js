function normalizeReplyLanguage(language) {
  return language === 'en' || language === 'zh-CN' ? language : undefined;
}

function latestReplyLanguage(messages) {
  const latest = messages.findLast(message => message.role === 'user' && message.source !== 'platform');
  return normalizeReplyLanguage(latest?.replyLanguage);
}

function replyLanguageFrame(messages) {
  const language = latestReplyLanguage(messages);
  if (!language) return '';
  const name = language === 'en' ? 'English' : 'Simplified Chinese';
  return `\n<reply-language>Use ${name} by default for user-facing explanations and summaries. Follow any explicit reply-language request from the user. Quote UI labels and evidence verbatim when needed. Keep tool names, arguments and structured output in their required formats.</reply-language>`;
}

module.exports = { normalizeReplyLanguage, latestReplyLanguage, replyLanguageFrame };
