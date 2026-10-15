const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

export async function askDeepSeek(prompt, systemRole, model) {
    console.log(`[Meta-Agent] 🐳 Запрос к облаку DeepSeek (${model}). Ждем ответа...`);
    
    const messages = [];
    if (systemRole) messages.push({ role: "system", content: systemRole });
    messages.push({ role: "user", content: prompt });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
        const response = await fetch(DEEPSEEK_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({ model: model, messages: messages, temperature: 0.2 }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        
        if (!data.choices || !data.choices[0]) {
            throw new Error("DeepSeek вернул пустой или нестандартный ответ.");
        }

        return data.choices[0].message.content;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError' || error.message.includes('abort')) {
            throw new Error('Таймаут: DeepSeek не ответил за 60 секунд.');
        }
        throw error;
    }
}