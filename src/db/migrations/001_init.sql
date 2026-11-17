-- Tyrex: начальная схема PostgreSQL (перенос с MongoDB).
-- id — 24 hex (формат ObjectId), чтобы старые id и ссылки из Mongo сохранились.
-- Деньги — NUMERIC (без потерь), сатоши и проценты — double precision, как Number в старой схеме.
-- Скрипт идемпотентный (IF NOT EXISTS), применяется при каждом старте сервера.

CREATE TABLE IF NOT EXISTS users (
  id                              varchar(24) PRIMARY KEY,
  tg_id                           bigint NOT NULL UNIQUE,
  username                        text NOT NULL DEFAULT '',
  language_code                   text DEFAULT 'en',
  role                            text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  referral_code                   text UNIQUE,
  upline_user_id                  varchar(24),
  is_trial_activated              boolean NOT NULL DEFAULT false,
  trial_activated_at              timestamptz,
  total_deposited_usd             numeric NOT NULL DEFAULT 0,
  account_status                  text NOT NULL DEFAULT 'NEWBIE' CHECK (account_status IN ('NEWBIE', 'DEPOSITOR', 'HOLDER', 'MINER')),
  analytics_financial_goal        double precision DEFAULT 50000,
  balance_wallet_usd              numeric NOT NULL DEFAULT 0,
  balance_staking_usd             numeric NOT NULL DEFAULT 0,
  balance_pending_withdrawal_usd  numeric NOT NULL DEFAULT 0,
  balance_total_profit_usd        numeric NOT NULL DEFAULT 0,
  balance_referral_usd            numeric NOT NULL DEFAULT 0,
  balance_wallet_sats             double precision NOT NULL DEFAULT 0,
  balance_last_daily_quiz_at      timestamptz,
  balance_referral_sats           double precision NOT NULL DEFAULT 0,
  is_banned                       boolean NOT NULL DEFAULT false,
  first_name                      text DEFAULT '',
  lang                            text CHECK (lang IN ('ru', 'uk', 'en')),
  can_message                     boolean NOT NULL DEFAULT false,
  bot_blocked_at                  timestamptz,
  timezone                        text DEFAULT 'Europe/Kyiv',
  notif_prefs_cards               boolean NOT NULL DEFAULT true,
  notif_prefs_partners            boolean NOT NULL DEFAULT true,
  notif_prefs_news                boolean NOT NULL DEFAULT true,
  notif_prefs_digest              boolean NOT NULL DEFAULT false,
  notif_prefs_btc                 boolean NOT NULL DEFAULT false,
  pending_ref                     text,
  source                          text,
  channel_gift_at                 timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_upline_idx ON users (upline_user_id);
CREATE INDEX IF NOT EXISTS users_created_idx ON users (created_at DESC);
-- Кошелёк не уходит в минус (страховка на уровне базы поверх условных списаний в коде)
DO $$ BEGIN ALTER TABLE users ADD CONSTRAINT users_wallet_non_negative CHECK (balance_wallet_usd >= 0) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS card_types (
  id            varchar(24) PRIMARY KEY,
  name          text NOT NULL,
  nominal_sats  numeric NOT NULL,
  client_apy    double precision NOT NULL,
  referral_apy  double precision NOT NULL DEFAULT 0,
  max_supply    integer NOT NULL,
  available     integer NOT NULL DEFAULT 0,
  image_path    text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_images (
  id            varchar(24) PRIMARY KEY,
  card_type_id  varchar(24) NOT NULL,
  image_data    text NOT NULL,
  index         integer NOT NULL
);
CREATE INDEX IF NOT EXISTS card_images_type_idx ON card_images (card_type_id, index);

CREATE TABLE IF NOT EXISTS user_cards (
  id                   varchar(24) PRIMARY KEY,
  user_id              varchar(24) NOT NULL,
  card_type_id         varchar(24) NOT NULL,
  serial_number        integer NOT NULL,
  status               text NOT NULL DEFAULT 'Inactive' CHECK (status IN ('Inactive', 'Active', 'Cooling', 'Finished')),
  nominal_sats         numeric NOT NULL,
  purchase_price_usd   numeric NOT NULL,
  current_profit_usd   numeric NOT NULL DEFAULT 0,
  current_profit_sats  numeric NOT NULL DEFAULT 0,
  cooling_payout_usd   numeric NOT NULL DEFAULT 0,
  is_trial             boolean NOT NULL DEFAULT false,
  image_url            text,
  unlock_at            timestamptz,
  last_accrual_date    timestamptz,
  remind_before_end    boolean DEFAULT true,
  remind_sent_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_type_id, serial_number)
);
CREATE INDEX IF NOT EXISTS user_cards_user_idx ON user_cards (user_id);
CREATE INDEX IF NOT EXISTS user_cards_status_idx ON user_cards (status, unlock_at);

CREATE TABLE IF NOT EXISTS card_history (
  id             varchar(24) PRIMARY KEY,
  card_type_id   varchar(24) NOT NULL,
  serial_number  integer NOT NULL,
  user_id        varchar(24) NOT NULL,
  event_type     text NOT NULL CHECK (event_type IN ('MINING_SESSION', 'PURCHASE', 'SOLD_BACK')),
  profit_usd     numeric DEFAULT 0,
  price_usd      numeric DEFAULT 0,
  started_at     timestamptz,
  ended_at       timestamptz DEFAULT now(),
  duration_days  double precision DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_history_serial_idx ON card_history (card_type_id, serial_number);

CREATE TABLE IF NOT EXISTS daily_earnings (
  id             varchar(24) PRIMARY KEY,
  user_id        varchar(24) NOT NULL,
  date           text NOT NULL,
  mining_sats    double precision NOT NULL DEFAULT 0,
  referral_sats  double precision NOT NULL DEFAULT 0,
  mining_usd     double precision NOT NULL DEFAULT 0,
  referral_usd   double precision NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id             varchar(24) PRIMARY KEY,
  user_id        varchar(24) NOT NULL,
  amount_usd     numeric NOT NULL,
  status         text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
  tx_hash        text DEFAULT '',
  admin_comment  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- hash-индекс: поиск по равенству; у старых записей встречаются очень длинные значения
CREATE INDEX IF NOT EXISTS deposit_requests_tx_idx ON deposit_requests USING hash (tx_hash);
CREATE INDEX IF NOT EXISTS deposit_requests_user_idx ON deposit_requests (user_id);
CREATE INDEX IF NOT EXISTS deposit_requests_status_idx ON deposit_requests (status);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id              varchar(24) PRIMARY KEY,
  user_id         varchar(24) NOT NULL,
  amount_usd      numeric NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'REJECTED')),
  wallet_address  text NOT NULL,
  processed_date  timestamptz,
  admin_comment   text,
  payout_tx_hash  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS withdrawal_requests_user_idx ON withdrawal_requests (user_id);
CREATE INDEX IF NOT EXISTS withdrawal_requests_status_idx ON withdrawal_requests (status);

CREATE TABLE IF NOT EXISTS exchange_orders (
  id                   varchar(24) PRIMARY KEY,
  user_id              varchar(24) NOT NULL,
  card_id              varchar(24),
  type                 text NOT NULL CHECK (type IN ('BUY', 'SELL')),
  btc_amount           double precision NOT NULL,
  app_usd_amount       double precision NOT NULL,
  binance_usdt_amount  double precision,
  executed_price       double precision,
  binance_order_id     text,
  status               text NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILED')),
  error_log            text,
  profit_delta         double precision,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exchange_orders_created_idx ON exchange_orders (created_at DESC);

CREATE TABLE IF NOT EXISTS income_events (
  id          varchar(24) PRIMARY KEY,
  user_id     varchar(24) NOT NULL,
  type        text NOT NULL CHECK (type IN ('CARD_PAYOUT', 'CARD_REFUND', 'REFERRAL_CLAIM')),
  amount_usd  numeric NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS income_events_user_idx ON income_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id          varchar(24) PRIMARY KEY,
  user_id     varchar(24) NOT NULL,
  title       text NOT NULL,
  message     text NOT NULL,
  type        text NOT NULL DEFAULT 'INFO' CHECK (type IN ('INFO', 'DEPOSIT', 'WITHDRAWAL', 'SYSTEM')),
  is_read     boolean NOT NULL DEFAULT false,
  key         text,
  params      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id               varchar(24) PRIMARY KEY,
  upline_user_id   varchar(24) NOT NULL,
  partner_user_id  varchar(24) NOT NULL,
  amount_sats      double precision NOT NULL,
  source_card_id   varchar(24),
  date             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_card_id, date)
);
CREATE INDEX IF NOT EXISTS referral_rewards_upline_idx ON referral_rewards (upline_user_id);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id           varchar(24) PRIMARY KEY,
  user_id      varchar(24) NOT NULL,
  date         text NOT NULL,
  question_id  text NOT NULL,
  answer       integer NOT NULL,
  correct      boolean NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id             varchar(24) PRIMARY KEY,
  admin_tg_id    bigint,
  admin_user_id  varchar(24),
  action         text NOT NULL,
  target_id      text NOT NULL,
  reason         text,
  meta           jsonb NOT NULL DEFAULT '{}',
  source         text NOT NULL CHECK (source IN ('bot', 'admin_panel')),
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_actions_target_idx ON admin_actions (target_id);
CREATE INDEX IF NOT EXISTS admin_actions_at_idx ON admin_actions (at DESC);

CREATE TABLE IF NOT EXISTS outbox (
  id          varchar(24) PRIMARY KEY,
  event_id    text NOT NULL UNIQUE,
  user_id     varchar(24),
  chat_id     text,
  thread_id   integer,
  template    text NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}',
  "group"     text NOT NULL DEFAULT 'money',
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts    integer NOT NULL DEFAULT 0,
  next_try_at timestamptz NOT NULL DEFAULT now(),
  locked_at   timestamptz,
  sent_at     timestamptz,
  message_id  bigint,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_queue_idx ON outbox (status, next_try_at);
CREATE INDEX IF NOT EXISTS outbox_sent_idx ON outbox (sent_at) WHERE status = 'sent';

CREATE TABLE IF NOT EXISTS tg_updates (
  id           varchar(24) PRIMARY KEY,
  update_id    bigint NOT NULL UNIQUE,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tg_updates_received_idx ON tg_updates (received_at);

CREATE TABLE IF NOT EXISTS tg_files (
  id          varchar(24) PRIMARY KEY,
  key         text NOT NULL UNIQUE,
  file_id     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Внешние ключи. NOT VALID: существующие строки (в т.ч. записи удалённых пользователей) не проверяются,
-- новые — проверяются. Скрипт переноса снимает ключи на время импорта и создаёт заново.
DO $$ BEGIN ALTER TABLE user_cards ADD CONSTRAINT user_cards_user_fk FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE user_cards ADD CONSTRAINT user_cards_type_fk FOREIGN KEY (card_type_id) REFERENCES card_types (id) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE deposit_requests ADD CONSTRAINT deposit_requests_user_fk FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE withdrawal_requests ADD CONSTRAINT withdrawal_requests_user_fk FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE income_events ADD CONSTRAINT income_events_user_fk FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE daily_earnings ADD CONSTRAINT daily_earnings_user_fk FOREIGN KEY (user_id) REFERENCES users (id) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
