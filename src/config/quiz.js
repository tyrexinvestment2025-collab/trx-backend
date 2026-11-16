/**
 * «Вопрос дня» в аналитике: простое обучение, без наград (деньги за ответы не начисляются).
 * Вопрос выбирается по дате (UTC) — у всех пользователей в один день один и тот же.
 * answer — индекс правильного варианта. Тексты на трёх языках.
 * TODO(customer): вопросы — пример, заказчик может заменить и дополнить.
 */
module.exports = [
    {
        id: 'q_cycle',
        answer: 1,
        q: {
            en: 'What happens after you stop a card?',
            uk: 'Що відбувається після зупинки карти?',
            ru: 'Что происходит после остановки карты?'
        },
        options: {
            en: ['Money arrives instantly', 'A cooling period starts, then the payout', 'The card disappears without a payout'],
            uk: ['Гроші надходять миттєво', 'Починається період охолодження, потім виплата', 'Карта зникає без виплати'],
            ru: ['Деньги приходят мгновенно', 'Начинается период охлаждения, затем выплата', 'Карта исчезает без выплаты']
        },
        explain: {
            en: 'After a stop the card cools down for a set period; then the purchase price and accrued income go to your wallet.',
            uk: 'Після зупинки карта охолоджується встановлений строк; потім ціна купівлі та нарахований дохід надходять на гаманець.',
            ru: 'После остановки карта охлаждается установленный срок; затем цена покупки и начисленный доход приходят на кошелёк.'
        }
    },
    {
        id: 'q_btc_income',
        answer: 0,
        q: {
            en: 'Why does the dollar amount of card income change?',
            uk: 'Чому змінюється доларова сума доходу карти?',
            ru: 'Почему меняется долларовая сумма дохода карты?'
        },
        options: {
            en: ['Income accrues in BTC, and the BTC rate changes', 'The platform changes it every day', 'It never changes'],
            uk: ['Дохід нараховується в BTC, а курс BTC змінюється', 'Платформа змінює її щодня', 'Вона ніколи не змінюється'],
            ru: ['Доход начисляется в BTC, а курс BTC меняется', 'Платформа меняет её каждый день', 'Она никогда не меняется']
        },
        explain: {
            en: 'The rate is a share of the card’s BTC nominal, so in dollars the income follows the BTC rate.',
            uk: 'Ставка — це частка BTC-номіналу карти, тому в доларах дохід іде за курсом BTC.',
            ru: 'Ставка — это доля BTC-номинала карты, поэтому в долларах доход следует за курсом BTC.'
        }
    },
    {
        id: 'q_apy',
        answer: 2,
        q: {
            en: 'What does “14% a year” mean?',
            uk: 'Що означає «14% річних»?',
            ru: 'Что значит «14% годовых»?'
        },
        options: {
            en: ['14% every month', '14% guaranteed forever', 'About 14% of the nominal over a year at the current rate'],
            uk: ['14% щомісяця', '14% гарантовано назавжди', 'Близько 14% від номіналу за рік за поточною ставкою'],
            ru: ['14% каждый месяц', '14% гарантированно навсегда', 'Около 14% от номинала за год по текущей ставке']
        },
        explain: {
            en: 'The annual rate is spread across the year: per day it is about 1/365 of it. The rate is set by the platform and may change.',
            uk: 'Річна ставка розподіляється на рік: за день це приблизно 1/365. Ставку встановлює платформа, вона може змінюватися.',
            ru: 'Годовая ставка распределяется на год: за день это примерно 1/365. Ставку устанавливает платформа, она может меняться.'
        }
    },
    {
        id: 'q_risk',
        answer: 1,
        q: {
            en: 'Which statement about risk is true?',
            uk: 'Яке твердження про ризик правдиве?',
            ru: 'Какое утверждение о риске верно?'
        },
        options: {
            en: ['Crypto income has no risk', 'Any investment can lose value; invest only what you can afford', 'Higher rate always means safer'],
            uk: ['Криптодохід без ризику', 'Будь-яке вкладення може втратити вартість; вкладайте лише те, що можете дозволити', 'Вища ставка — завжди надійніше'],
            ru: ['Криптодоход без риска', 'Любое вложение может потерять в цене; вкладывайте только то, что можете позволить', 'Выше ставка — всегда надёжнее']
        },
        explain: {
            en: 'No investment is risk-free. A higher rate usually means higher risk, not lower.',
            uk: 'Вкладень без ризику не буває. Вища ставка зазвичай означає вищий ризик, а не нижчий.',
            ru: 'Вложений без риска не бывает. Более высокая ставка обычно означает больший риск, а не меньший.'
        }
    },
    {
        id: 'q_partners',
        answer: 0,
        q: {
            en: 'Where does partner income go when you tap “Claim”?',
            uk: 'Куди потрапляє партнерський дохід після «Забрати»?',
            ru: 'Куда попадает партнёрский доход после «Забрать»?'
        },
        options: {
            en: ['To your USD wallet at the current BTC rate', 'Onto a new card', 'It stays in BTC forever'],
            uk: ['На USD-гаманець за поточним курсом BTC', 'На нову карту', 'Він назавжди лишається в BTC'],
            ru: ['На USD-кошелёк по текущему курсу BTC', 'На новую карту', 'Он навсегда остаётся в BTC']
        },
        explain: {
            en: 'Partner income accrues in satoshi and is converted to dollars at the moment you claim it.',
            uk: 'Партнерський дохід нараховується в сатоші й конвертується в долари в момент, коли ви його забираєте.',
            ru: 'Партнёрский доход начисляется в сатоши и переводится в доллары в момент, когда вы его забираете.'
        }
    },
    {
        id: 'q_sats',
        answer: 2,
        q: {
            en: 'How many satoshi are in 1 BTC?',
            uk: 'Скільки сатоші в 1 BTC?',
            ru: 'Сколько сатоши в 1 BTC?'
        },
        options: {
            en: ['1,000', '1,000,000', '100,000,000'],
            uk: ['1 000', '1 000 000', '100 000 000'],
            ru: ['1 000', '1 000 000', '100 000 000']
        },
        explain: {
            en: 'A satoshi is the smallest unit of bitcoin: one hundred-millionth of 1 BTC.',
            uk: 'Сатоші — найменша одиниця біткоїна: одна стомільйонна 1 BTC.',
            ru: 'Сатоши — самая мелкая единица биткоина: одна стомиллионная 1 BTC.'
        }
    },
    {
        id: 'q_trc20',
        answer: 1,
        q: {
            en: 'What do you need to check before a withdrawal?',
            uk: 'Що потрібно перевірити перед виведенням?',
            ru: 'Что нужно проверить перед выводом?'
        },
        options: {
            en: ['Nothing, any address works', 'That the address is in the TRC20 network', 'That the amount is a round number'],
            uk: ['Нічого, підійде будь-яка адреса', 'Що адреса в мережі TRC20', 'Що сума кругла'],
            ru: ['Ничего, подойдёт любой адрес', 'Что адрес в сети TRC20', 'Что сумма круглая']
        },
        explain: {
            en: 'Withdrawals are sent in USDT over TRC20. A transfer to an address in another network may be lost.',
            uk: 'Виведення надсилається в USDT мережею TRC20. Переказ на адресу в іншій мережі може бути втрачено.',
            ru: 'Вывод отправляется в USDT по сети TRC20. Перевод на адрес в другой сети может потеряться.'
        }
    }
];
