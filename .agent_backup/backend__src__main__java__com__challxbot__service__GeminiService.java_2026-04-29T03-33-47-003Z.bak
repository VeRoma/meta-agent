package com.challxbot.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

@Service
@Slf4j
public class GeminiService {

    @Value("${google.ai.key}")
    private String apiKey;

    private static final String MODEL_NAME = "gemini-3-pro-preview"; // Ваша модель
    private static final String API_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s";

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Генерирует УРОК (HTML). Стиль: Дружелюбный репетитор.
     */
    public String generateLessonContent(String topicName, int variant) {
        log.info("🤖 AI: Генерирую урок '{}' (Вариант {})", topicName, variant);

        String prompt = String.format(
                "Ты — профессиональный, но дружелюбный репетитор английского языка. " +
                        "Напиши теоретический урок по теме '%s' для начинающих (уровень A1-A2). " +
                        "Вариант объяснения №%d (придумай уникальные примеры, отличные от других вариантов). " +
                        "Структура: 1) Короткое и понятное объяснение правила на русском. 2) 3-4 примера на английском с переводом. 3) Небольшой совет (Tip). " +
                        "Стиль: Поддерживающий, спокойный, без сленга, но не сухой. " +
                        "Формат: Верни ТОЛЬКО HTML код (внутри <div>). Используй теги <h2>, <p>, <ul>, <li>, <strong>, <span class='highlight'>. Используй немного эмодзи для акцентов.",
                topicName, variant
        );

        return sendRequestToGemini(prompt, false);
    }

    /**
     * Генерирует КВИЗ (JSON).
     */
    public String generateQuiz(String topicName, int variant) {
        log.info("🤖 AI: Генерирую тест для '{}' (Вариант {})", topicName, variant);

        String prompt = String.format(
                "Создай тест из 5 вопросов по теме '%s' (Вариант №%d). " +
                        "Вопросы должны проверять понимание темы. " +
                        "Вопросы на английском (простые), объяснения ошибок СТРОГО НА РУССКОМ. " +
                        "Верни ТОЛЬКО валидный JSON массив (без Markdown). " +
                        "Структура: [{ \"question\": \"...\", \"options\": [\"A\", \"B\", \"C\"], \"correctIndex\": 0, \"explanation\": \"...\" }]",
                topicName, variant
        );

        return sendRequestToGemini(prompt, true);
    }

    private String sendRequestToGemini(String prompt, boolean isJsonExpected) {
        if (apiKey == null || apiKey.isBlank()) return "API Key Error";

        try {
            String escapedPrompt = prompt.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
            String jsonBody = String.format("{\"contents\": [{\"parts\": [{\"text\": \"%s\"}]}]}", escapedPrompt);
            String url = String.format(API_URL_TEMPLATE, MODEL_NAME, apiKey);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                log.error("❌ AI Error {}: {}", response.statusCode(), response.body());
                return isJsonExpected ? "[]" : "<p>Ошибка AI генерации.</p>";
            }

            String rawText = extractTextFromJson(response.body());
            return isJsonExpected ? cleanJson(rawText) : cleanHtmlMarkdown(rawText);

        } catch (Exception e) {
            log.error("❌ Exception", e);
            return isJsonExpected ? "[]" : "<p>Ошибка сервиса.</p>";
        }
    }

    private String cleanJson(String text) {
        text = text.trim();
        if (text.startsWith("```json")) text = text.substring(7);
        else if (text.startsWith("```")) text = text.substring(3);
        if (text.endsWith("```")) text = text.substring(0, text.length() - 3);
        return text.trim();
    }

    private String cleanHtmlMarkdown(String text) {
        text = text.trim();
        if (text.startsWith("```html")) text = text.substring(7);
        else if (text.startsWith("```")) text = text.substring(3);
        if (text.endsWith("```")) text = text.substring(0, text.length() - 3);
        return text.trim();
    }

    private String extractTextFromJson(String jsonResponse) {
        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode textNode = root.at("/candidates/0/content/parts/0/text");
            return textNode.isMissingNode() ? "" : textNode.asText();
        } catch (Exception e) {
            return "";
        }
    }
}