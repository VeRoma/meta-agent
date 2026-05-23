package com.challxbot.domain;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "vocabulary")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class Vocabulary {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String word;

    @Column(nullable = false)
    private String translationShort;

    @Column(columnDefinition = "TEXT")
    private String translationFull;

    @Column(nullable = false)
    private Integer rank;

    private String partOfSpeech;

    @Column(columnDefinition = "TEXT")
    private String traps; // JSON массив ловушек

    @Column(columnDefinition = "TEXT")
    private String examples; // 🔥 НОВОЕ ПОЛЕ: JSON массив примеров (3 шт)

    // Конструктор для удобства
    public Vocabulary(String word, String translationShort, String translationFull, Integer rank, String partOfSpeech, String traps, String examples) {
        this.word = word;
        this.translationShort = translationShort;
        this.translationFull = translationFull;
        this.rank = rank;
        this.partOfSpeech = partOfSpeech;
        this.traps = traps;
        this.examples = examples;
    }
}