import { exec } from 'child_process';
import path from 'path';

export function runTests(targetProjectFolder) {
    return new Promise((resolve) => {
        const targetAbsolute = path.resolve(process.cwd(), targetProjectFolder);
        
        exec('npm test', { cwd: targetAbsolute }, (error, stdout, stderr) => {
            if (error) {
                return resolve({
                    success: false,
                    // Собираем и стандартный вывод, и ошибки
                    output: stdout + '\n' + stderr 
                });
            }
            return resolve({
                success: true,
                output: stdout
            });
        });
    });
}