const { Bot } = require('grammy');
const { cfg } = require('./config');

/**
 * Один экземпляр grammY Bot на процесс. botInfo передаём явно (из getMe при старте),
 * чтобы обработка апдейтов не делала лишний запрос. В тестах setBot() подставляет бота
 * с перехватом вызовов API.
 */
let bot = null;

const getBot = () => {
  if (bot) return bot;
  const { token, botUsername } = cfg();
  if (!token) return null;
  bot = new Bot(token, {
    botInfo: {
      id: Number(token.split(':')[0]) || 0, is_bot: true, first_name: 'Tyrex', username: botUsername,
      can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: true,
    },
  });
  return bot;
};

const setBot = (b) => { bot = b; };

module.exports = { getBot, setBot };
