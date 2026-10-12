# META-AGENT Project Map

> This map contains the structural overview of exported modules to help the LLM navigate the codebase efficiently.

### 📄 meta-agent.js
- (Internal logic / No exported modules)

### 📄 src/cli/chat.js
- **startCLI** (async function)
- **processAgentTask** (async function)

### 📄 src/cli/runner.js
- **runDevServer** (function)
- **stopDevServer** (function)

### 📄 src/core/linter.js
- **runLinter** (async function)

### 📄 src/core/llm.js
- **askModel** (async function)
- **askLocalModel** (async function)

### 📄 src/core/routing.js
- **determineRelevantFiles** (async function)

### 📄 src/core/session.js
- **initSession** (function)
- **getSession** (function)
- **appendToSession** (function)
- **clearSession** (function)
- **compressSessionIfNeeded** (async function)

### 📄 src/fs/docs-generator.js
- **generateDocumentation** (async function)
- **generateIndexes** (async function)

### 📄 src/fs/file-manager.js
- **getProjectFiles** (function)
- **readFilesContent** (function)
- **generateProjectTree** (function)

### 📄 src/fs/map-builder.js
- **buildProjectMap** (function)

### 📄 src/fs/patcher.js
- **applyPatches** (async function)
- **abortSessionPatches** (async function)
- **applyRedoPatches** (async function)
- **clearSessionBackups** (function)

### 📄 test-fs.js
- (Internal logic / No exported modules)

