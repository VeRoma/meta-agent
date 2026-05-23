package com.challxbot.config;

import com.challxbot.domain.Lesson;
import com.challxbot.domain.Topic;
import com.challxbot.repository.LessonRepository;
import com.challxbot.repository.TopicRepository;
import com.challxbot.service.GeminiService;
import com.challxbot.service.VocabularyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
@RequiredArgsConstructor
@Slf4j
@SuppressWarnings("unused")
public class DataInitializer {

    private final TopicRepository topicRepository;
    private final LessonRepository lessonRepository;
    private final GeminiService geminiService;
    private final VocabularyService vocabularyService; // <-- Добавили сервис словаря

    // Список тем для генерации
    private final List<String> TOPICS = List.of(
            "The Verb 'to be' (Глагол быть)",
            "Present Simple (Настоящее простое)",
            "Present Continuous (Настоящее продолженное)",
            "Past Simple (Прошедшее простое)",
            "Future Simple (Will vs Going to)",
            "Articles (A/An/The)",
            "Plural Nouns (Множественное число)",
            "Pronouns (Местоимения)",
            "Adjectives (Прилагательные)",
            "Prepositions of Place (In/On/At)",
            "Modal Verbs (Can/Must/Should)"
    );

    @Bean
    public CommandLineRunner initData() {
        return args -> {
            log.info("🚀 Проверка данных при старте...");

            // --- ЭТАП 1: УРОКИ И ТЕМЫ ---
            long topicCount = topicRepository.count();
            if (topicCount > 0) {
                log.info("✅ Уроки уже есть (найдено {} тем). Пропускаем генерацию уроков.", topicCount);
            } else {
                log.info("🔥 База уроков пуста! Начинаем генерацию...");
                generateLessons();
            }

            // --- ЭТАП 2: СЛОВАРЬ ---
            // VocabularyService сам внутри проверяет наличие слов, но можно добавить лог и тут
            log.info("📚 Запуск проверки словаря...");
            vocabularyService.generateAndSaveVocabulary();

            log.info("🏁 Инициализация завершена. Бот готов к работе!");
        };
    }

    private void generateLessons() {
        // 1. Очищаем базу для чистого старта (на всякий случай, если там мусор)
        lessonRepository.deleteAll();
        topicRepository.deleteAll();

        // 2. Проходим по всем темам
        for (String topicName : TOPICS) {
            log.info("📘 Обработка темы: {}", topicName);

            // Создаем тему
            Topic topic = topicRepository.save(Topic.builder().name(topicName).isActive(true).build());

            // 3. Создаем 3 варианта для каждой темы
            for (int variant = 1; variant <= 3; variant++) {
                try {
                    log.info("   ⏳ Генерация варианта {}/3...", variant);

                    // Генерируем теорию
                    String lessonContent = geminiService.generateLessonContent(topicName, variant);
                    Thread.sleep(2000); // Пауза для API

                    // Генерируем тест (JSON)
                    String quizJson = geminiService.generateQuiz(topicName, variant);
                    Thread.sleep(2000); // Пауза

                    // Сохраняем урок
                    Lesson lesson = new Lesson(
                            topicName + " (Var " + variant + ")",
                            lessonContent,
                            quizJson,
                            topic,
                            variant
                    );
                    lessonRepository.save(lesson);

                } catch (Exception e) {
                    log.error("   ❌ Ошибка генерации варианта {} для темы {}", variant, topicName, e);
                }
            }
        }
    }
}
