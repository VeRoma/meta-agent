# PROJECT MAP & DEPENDENCY GRAPH

> Structural overview, dependency graph, and static health flags for LLM navigation.
- **Module System**: `module`
- **Entry Points**: `meta-agent.js`

### 📄 .gitignore
- (Configuration / Ignore file)

### 📄 core/llm.js (46 lines)
- ⚠️ [ORPHAN / POTENTIALLY DEAD FILE: Not imported by any module and not listed as an entry point]
- *External Core Imports*: `../ai-core/index.js`
- **ai** (const)

### 📄 meta-agent.js (81 lines)
- *Imports*: `src/fs/map-builder.js`, `src/cli/chat.js`
- *Role*: Entry point / Controller / Service / Test
- (Internal logic / No exported functions)

### 📄 meta-bot/meta-bot.js (60 lines)
- ⚠️ [CJS IN ESM: file uses require() or module.exports inside an ESM ("type": "module") project]
- *Role*: Entry point / Controller / Service / Test
- (Internal logic / No exported functions)

### 📄 meta-bot/package.json
- (Configuration / Ignore file)

### 📄 meta.config.json
- (Configuration / Ignore file)

### 📄 package.json
- (Configuration / Ignore file)

### 📄 src/cli/chat.js (559 lines)
- ⚠️ [GOD FILE: 559 lines > 300 threshold — consider splitting responsibilities]
- ⚠️ [BROKEN IMPORT: ../core/session.js -> src/core/session.js does not exist]
- ⚠️ [BROKEN IMPORT: ../core/llm.js -> src/core/llm.js does not exist]
- ⚠️ [BROKEN IMPORT: ../core/llm/ollama.js -> src/core/llm/ollama.js does not exist]
- ⚠️ [BROKEN IMPORT: ../core/routing.js -> src/core/routing.js does not exist]
- ⚠️ [BROKEN IMPORT: ../core/linter.js -> src/core/linter.js does not exist]
- ⚠️ [BROKEN IMPORT: ../core/tester.js -> src/core/tester.js does not exist]
- ⚠️ [BROKEN IMPORT: ../core/command-guard.js -> src/core/command-guard.js does not exist]
- ⚠️ [BROKEN IMPORT: ../core/json-utils.js -> src/core/json-utils.js does not exist]
- *Imports*: `src/fs/map-builder.js`, `src/fs/file-manager.js`, `src/fs/docs-generator.js`, `src/fs/patcher.js`, `src/cli/runner.js`
- *Imported by*: `meta-agent.js`
- **startCLI** (async function)
- **processAgentTask** (async function)

### 📄 src/cli/runner.js (135 lines)
- *Imported by*: `src/cli/chat.js`
- **runDevServer** (function)
- **stopDevServer** (function)

### 📄 src/fs/docs-generator.js (44 lines)
- ⚠️ [BROKEN IMPORT: ../core/llm.js -> src/core/llm.js does not exist]
- *Imported by*: `src/cli/chat.js`
- **generateDocumentation** (async function)

### 📄 src/fs/file-manager.js (47 lines)
- *Imports*: `src/fs/safe-path.js`
- *Imported by*: `src/cli/chat.js`, `tests/patcher.test.js`
- **readFilesContent** (function)

### 📄 src/fs/map-builder.js (9 lines)
- *External Core Imports*: `../ai-core/map-builder.js`
- *Imported by*: `meta-agent.js`, `src/cli/chat.js`, `src/fs/patcher.js`
- (Internal logic / No exported functions)

### 📄 src/fs/patch-guard.js (86 lines)
- *Imported by*: `src/fs/patcher.js`, `tests/guards.test.js`
- **MIN_SIZE_RATIO** (const)
- **findPlaceholder** (function)
- **checkJsSyntax** (function): Syntax-only check for JS. Tries ESM first, then CommonJS, so it works - regardless of which module system the target project uses.
- **validateFileUpdate** (function): Validates one proposed file write BEFORE anything touches the disk.

### 📄 src/fs/patcher.js (300 lines)
- *Imports*: `src/fs/map-builder.js`, `src/fs/safe-path.js`, `src/fs/patch-guard.js`
- *Imported by*: `src/cli/chat.js`, `tests/patcher.test.js`
- **applyPatches** (async function)
- **abortSessionPatches** (async function)
- **applyRedoPatches** (async function)
- **clearSessionBackups** (function)

### 📄 src/fs/safe-path.js (60 lines)
- *Imported by*: `src/fs/file-manager.js`, `src/fs/patcher.js`, `tests/guards.test.js`
- **resolveInside** (function): Resolves a model-supplied path against the project root and guarantees - the result stays inside that root (blocks "../" traversal and absolute paths).
- **isSecretPath** (function): Secrets: must never be sent to a cloud LLM.
- **isProtectedPath** (function): Paths the agent may neither modify nor delete.
- **resolveProjectFile** (function): Resolve + protect: returns both absolute and POSIX-style relative path, - or throws if the path is unsafe to write.

### 📄 tests/guards.test.js (88 lines)
- ⚠️ [CJS IN ESM: file uses require() or module.exports inside an ESM ("type": "module") project]
- ⚠️ [BROKEN IMPORT: ../src/core/command-guard.js -> src/core/command-guard.js does not exist]
- ⚠️ [BROKEN IMPORT: ../src/core/json-utils.js -> src/core/json-utils.js does not exist]
- *Imports*: `src/fs/safe-path.js`, `src/fs/patch-guard.js`
- *Role*: Entry point / Controller / Service / Test
- **askModel** (async function)
- **v** (const)
- **a** (const)
- **b** (const)

### 📄 tests/patcher.test.js (103 lines)
- *Imports*: `src/fs/patcher.js`, `src/fs/file-manager.js`
- *Role*: Entry point / Controller / Service / Test
- **a** (const)
- **t** (const)
- **a** (const)
- **x** (const)
- **a** (const)
- **a** (const)
- **a** (const)
- **t** (const)
- **n** (const)
- **n** (const)
- **a** (const)
- **t** (const)
- **a** (const)
- **t** (const)
- **n** (const)
- **a** (const)
- **a** (const)
- **a** (const)
- **a** (const)

