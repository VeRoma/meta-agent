const SHELL_META_RE = /[;&|><`$]|\$\(|\r|\n/;

const SAFE_PATTERNS = [
    /^npm\s+(install|i|ci|test|t)(\s+--ignore-scripts)?$/,
    /^npm\s+run\s+(test|lint|build|check)$/,
    /^node\s+--test(\s+[a-zA-Z0-9_.\-\/]+)*$/,
    /^git\s+(status|diff|log|branch|add\s+\.|add\s+-A)$/,
    /^git\s+commit\s+-m\s+"[^"$`\\]+"$/,
    /^git\s+commit\s+-m\s+'[^']+'$/
];

const HIGH_RISK_PATTERNS = [
    { re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\b/, msg: 'Recursive deletion (rm -rf)' },
    { re: /\bgit\s+(push|reset\s+--hard|clean\s+-[a-zA-Z]*f)\b/, msg: 'Destructive or remote git operation' },
    { re: /\b(curl|wget|Invoke-WebRequest)\b/i, msg: 'Network fetch in shell command' },
    { re: /\.env\b/, msg: 'Access to .env secrets file' },
    { re: /\bnpm\s+(install|i)\s+\S+/, msg: 'Installing new package (supply-chain check required)' }
];

export function classifyCommand(rawCmd) {
    if (typeof rawCmd !== 'string' || !rawCmd.trim()) {
        return { level: 'confirm', warning: 'Empty or non-string command' };
    }
    const cmd = rawCmd.trim();

    for (const { re, msg } of HIGH_RISK_PATTERNS) {
        if (re.test(cmd)) {
            return { level: 'confirm', warning: msg };
        }
    }

    if (SHELL_META_RE.test(cmd)) {
        return { level: 'confirm', warning: 'Contains shell chaining, redirection, or subshell operators' };
    }

    if (SAFE_PATTERNS.some(re => re.test(cmd))) {
        return { level: 'safe' };
    }

    return { level: 'confirm', warning: 'Command not in safe whitelist' };
}
