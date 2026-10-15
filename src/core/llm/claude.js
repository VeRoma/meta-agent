import Anthropic from '@anthropic-ai/sdk';

let anthropic = null;

export function initClaude(apiKey) {
    if (apiKey && !anthropic) {
        anthropic = new Anthropic({ apiKey });
    }
}

export async function askClaude(prompt, systemRole, model, effort = "high") {
    if (!anthropic) throw new Error("CLAUDE_API_KEY не найден в .env!");
    console.log(`[Meta-Agent] 🧠 Запрос к Claude (${model})...`);
    
    const requestParams = {
        model: model,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: effort },
        messages: [{ role: "user", content: prompt }]
    };

    if (systemRole) requestParams.system = systemRole;

    const response = await anthropic.messages.create(requestParams);
    const textBlock = response.content.find(block => block.type === 'text');
    return textBlock ? textBlock.text : '';
}