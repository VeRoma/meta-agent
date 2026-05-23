package com.challxbot.controller;

import com.challxbot.domain.Vocabulary;
import com.challxbot.repository.VocabularyRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@RestController
@RequestMapping("/api/vocabulary")
@RequiredArgsConstructor
@Slf4j
public class VocabularyController {

    private final VocabularyRepository vocabularyRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @GetMapping("/challenge")
    public ResponseEntity<List<WordQuizDto>> getVocabularyChallenge() {
        // Для теста берем первые 10 слов (топ-10).
        // В будущем тут будет логика UserWordProgress (умное повторение).
        List<Vocabulary> words = vocabularyRepository.findByRankBetween(1, 10);

        List<WordQuizDto> quizzes = new ArrayList<>();

        for (Vocabulary vocab : words) {
            try {
                // 1. Берем ловушки из JSON-строки
                List<String> options = objectMapper.readValue(vocab.getTraps(), new TypeReference<>() {});

                // 2. Добавляем правильный ответ
                options.add(vocab.getTranslationShort());

                // 3. Перемешиваем варианты
                Collections.shuffle(options);

                // 4. Ищем индекс правильного ответа после перемешивания
                int correctIndex = options.indexOf(vocab.getTranslationShort());

                quizzes.add(new WordQuizDto(
                        vocab.getWord(),
                        options,
                        correctIndex,
                        vocab.getTranslationFull()
                ));

            } catch (Exception e) {
                log.error("Ошибка обработки слова {}", vocab.getWord(), e);
            }
        }

        return ResponseEntity.ok(quizzes);
    }

    // DTO для отправки на фронт
    public record WordQuizDto(
            String word,
            List<String> options,
            int correctIndex,
            String translationFull
    ) {}
}