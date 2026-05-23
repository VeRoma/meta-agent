package com.challxbot.service;

import com.challxbot.repository.UserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.telegram.telegrambots.bots.TelegramLongPollingBot;
import org.telegram.telegrambots.meta.api.methods.send.SendMessage;
import org.telegram.telegrambots.meta.api.objects.Update;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.InlineKeyboardMarkup;
import org.telegram.telegrambots.meta.api.objects.replykeyboard.buttons.InlineKeyboardButton;
import org.telegram.telegrambots.meta.api.objects.webapp.WebAppInfo;
import org.telegram.telegrambots.meta.exceptions.TelegramApiException;

import java.util.ArrayList;
import java.util.List;

@Service
@Slf4j
public class TelegramBotService extends TelegramLongPollingBot {

    @Value("${telegram.bot.username}")
    private String botUsername;

    @Value("${telegram.webapp.url}")
    private String webAppUrl;

    private final UserRepository userRepository;

    public TelegramBotService(@Value("${telegram.bot.token}") String botToken,
                              UserRepository userRepository) {
        super(botToken);
        this.userRepository = userRepository;
    }

    @Override
    public void onUpdateReceived(Update update) {
        // ЛОГ-1: Проверяем, видит ли бот вообще что-то
        log.info("📩 Получен апдейт от Telegram: {}", update);

        if (update.hasMessage() && update.getMessage().hasText()) {
            String messageText = update.getMessage().getText();
            long chatId = update.getMessage().getChatId();

            if (messageText.equals("/start")) {
                // ЛОГ-2: Поймали команду /start
                log.info("▶️ Команда /start от пользователя ID: {}", chatId);

                String firstName = update.getMessage().getFrom().getFirstName();
                if (firstName == null) firstName = "Друг";

                sendWelcomeMessage(chatId, firstName);
            }
        }
    }

    private void sendWelcomeMessage(long chatId, String firstName) {
        SendMessage message = new SendMessage();
        message.setChatId(String.valueOf(chatId));

        // 🔥 ЗАФИКСИРОВАННЫЙ ТЕКСТ (С HTML разметкой)
        String text = String.format(
                "Поздравляю, <b>%s</b>! 👋\n\n" +
                        "Ты запустил бота <b>Chall_X_Bot</b>.\n\n" +
                        "Чтобы зарегистрироваться и войти в главный интерфейс приложения, нажми кнопку <b>«📱 Открыть Chall_X_Bot»</b> внизу этого сообщения (или кнопку Меню слева от поля ввода). 👇",
                firstName
        );

        message.setText(text);
        message.setParseMode("HTML"); // Важно для работы <b> и \n

        // Кнопка
        InlineKeyboardMarkup markup = new InlineKeyboardMarkup();
        List<List<InlineKeyboardButton>> rows = new ArrayList<>();
        List<InlineKeyboardButton> row = new ArrayList<>();

        InlineKeyboardButton webAppBtn = new InlineKeyboardButton();
        webAppBtn.setText("📱 Открыть Chall_X_Bot"); // Текст на кнопке

        // Проверка URL из настроек
        if (webAppUrl != null && !webAppUrl.isEmpty()) {
            log.info("🔗 Добавляю кнопку WebApp со ссылкой: {}", webAppUrl);
            WebAppInfo webAppInfo = new WebAppInfo(webAppUrl);
            webAppBtn.setWebApp(webAppInfo);
        } else {
            log.warn("⚠️ URL WebApp не задан в application.properties! Кнопка будет вести в никуда.");
            // Для теста можно поставить google, чтобы кнопка хотя бы отобразилась
            webAppBtn.setUrl("https://google.com");
        }

        row.add(webAppBtn);
        rows.add(row);
        markup.setKeyboard(rows);
        message.setReplyMarkup(markup);

        try {
            execute(message);
            log.info("✅ Приветствие успешно отправлено пользователю {}", chatId);
        } catch (TelegramApiException e) {
            log.error("❌ Ошибка при отправке сообщения в Telegram: ", e);
        }
    }

    @Override
    public String getBotUsername() {
        return botUsername;
    }

    @jakarta.annotation.PostConstruct
    public void init() {
        log.info("🤖 Бот инициализирован!");
        log.info("📝 Имя бота: '{}'", getBotUsername());
        log.info("🔑 Токен (первые 5 символов): '{}...'", getBotToken().substring(0, 5));
    }
}