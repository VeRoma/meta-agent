package com.challxbot.repository;

import com.challxbot.domain.Vocabulary;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface VocabularyRepository extends JpaRepository<Vocabulary, Long> {

    // Найти слова определенного ранга (для пейджинга/челленджа)
    List<Vocabulary> findByRankBetween(Integer startRank, Integer endRank);

    // Проверить, есть ли слова в базе (чтобы не грузить заново)
    boolean existsByWord(String word);
}