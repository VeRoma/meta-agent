// Мост между движком и интерфейсом: движок не знает про readline, а интерфейс регистрирует
// здесь свои обработчики. Без интерфейса (тесты, Telegram) любое подтверждение — отказ.
let confirmHandler = async () => false;
let idleHandler = () => {};

export function setConfirmHandler(handler) {
    confirmHandler = handler;
}

/** Спрашивает у разработчика подтверждение действия. */
export function confirm(question) {
    return confirmHandler(question);
}

export function setIdleHandler(handler) {
    idleHandler = handler;
}

/** Фоновая работа (авто-исправление после падения) закончилась — интерфейс может снова показать приглашение. */
export function notifyIdle() {
    idleHandler();
}
