import { runLinter } from './linter.js';
import { runTests } from './tester.js';

/**
 * Линтер -> тесты. Проблемы окружения дают предупреждения, а не «ошибки кода».
 * @returns {Promise<{success: true} | {success: false, kind: 'Linter'|'Tests', output: string}>}
 */
export async function runProjectChecks(targetProject, updatedFiles) {
    const lintResult = await runLinter(targetProject, updatedFiles);
    (lintResult.warnings || []).forEach(w => console.log(`⚠️ ${w}`));
    if (!lintResult.success) return { success: false, kind: 'Linter', output: lintResult.error };

    console.log("✅ Линтер: ошибок кода нет. Запуск юнит-тестов...");
    const testResult = await runTests(targetProject);
    (testResult.warnings || []).forEach(w => console.log(`⚠️ ${w}`));
    if (!testResult.success) return { success: false, kind: 'Tests', output: testResult.output };

    return { success: true };
}
