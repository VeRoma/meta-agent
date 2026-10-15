const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/api/generate';

/**
 * Адаптер для локальной Ollama
 */
export async function askLocalModel(prompt, targetModel) {
    console.log(`[Meta-Agent] Запрос к локальной модели (${targetModel})...`);
    const response = await fetch(OLLAMA_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: targetModel,
            prompt: prompt,
            stream: false,
            options: { num_ctx: 8192, num_gpu: 0 }
        }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.response || '';
}