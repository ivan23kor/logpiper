# LogPiper MCP Server

A sophisticated MCP (Model Context Protocol) server that streams terminal command logs with intelligent error detection and proactive notifications to Claude Code.

## Features

🚀 **Multi-Session Support**: Run multiple `logpiper` instances simultaneously across different terminals  
📊 **Real-time Streaming**: Only delivers new, unfetched logs via cursor-based streaming  
🔍 **Smart Error Detection**: AI-powered pattern matching for build failures, test errors, runtime issues  
📢 **Proactive Notifications**: Automatic alerts to Claude Code when critical errors occur  
🎯 **Context-Rich Alerts**: Error notifications include file paths, suggested fixes, and actionable buttons  
⚡ **Command Intelligence**: Specialized error detection for npm, docker, python, and more  

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Install globally (optional)
npm link
```

## Usage

### 1. Start the MCP Server

Configure Claude Code to use the LogPiper MCP server by adding to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "logpiper": {
      "command": "node",
      "args": ["cmd", "/c", "C:\\Users\\Ivan\\Desktop\\logpiper\\dist\\server.js"]
    }
  }
}
```

### 2. Use LogPiper CLI

Start monitoring any command by prefixing it with `logpiper`:

```bash
# Monitor development server
logpiper npm run dev

# Monitor Docker Compose logs
logpiper docker-compose logs backend -f

# Monitor test execution  
logpiper npm test

# Monitor Python script
logpiper python app.py
```

### 3. Claude Code Integration

Once set up, Claude Code can:

- **View Live Logs**: `get_new_logs` - Stream only new logs since last read
- **List Sessions**: `list_sessions` - See all active monitoring sessions
- **Search Logs**: `search_logs` - Find specific errors or patterns
- **Get Alerts**: Receive proactive notifications when errors occur

## Example Workflow

1. **Start Monitoring**:
   ```bash
   # Terminal 1
   logpiper npm run dev
   
   # Terminal 2  
   logpiper docker-compose logs backend -f
   ```

2. **Error Detection**: When a TypeScript compilation error occurs, Claude Code automatically receives:
   ```json
   {
     "severity": "critical",
     "category": "build_failure", 
     "summary": "npm build failed in /path/to/project",
     "details": {
       "firstError": "Property 'user' does not exist on type 'Props'",
       "context": ["src/components/UserProfile.tsx:15:7"],
       "suggestedFix": "Add 'user' property to Props interface"
     },
     "actions": [
       {"type": "view_logs", "label": "View Full Logs"},
       {"type": "open_file", "label": "Open UserProfile.tsx", "path": "src/components/UserProfile.tsx:15"}
     ]
   }
   ```

3. **Claude Code Response**: Claude Code can immediately:
   - Open the problematic file
   - Analyze the error context  
   - Suggest and implement fixes
   - Monitor for resolution

## MCP Tools Available

| Tool | Description | Usage |
|------|-------------|-------|
| `get_new_logs` | Stream new logs since cursor | Real-time log monitoring |
| `list_sessions` | List all logging sessions | Session management |  
| `get_session_info` | Get detailed session info | Debugging context |
| `search_logs` | Search through logs | Error investigation |
| `acknowledge_error` | Mark errors as seen | Error management |
| `get_error_history` | View recent errors | Error tracking |

## Supported Error Patterns

- **Build Failures**: TypeScript, Webpack, Babel, Vite, Rollup
- **Test Failures**: Jest, Mocha, Cypress, Playwright, Vitest  
- **Runtime Errors**: JavaScript/Python exceptions, memory issues
- **Docker Issues**: Build failures, daemon errors, container crashes
- **Dependency Problems**: Missing modules, version conflicts

## Architecture

```
logpiper/
├── src/
│   ├── cli.ts           # Command wrapper CLI
│   ├── server.ts        # MCP server core
│   ├── error-detector.ts # Smart error analysis
│   ├── notification.ts  # Proactive alerts
│   ├── log-manager.ts   # Session & log management  
│   └── types.ts         # TypeScript interfaces
├── patterns/           # Error pattern configurations
└── dist/              # Compiled JavaScript
```

## Session Management

Each `logpiper` command creates a unique session:

- **Session ID**: `project_command_timestamp`  
- **Metadata**: Project directory, command, arguments
- **Streaming**: Only new logs delivered via cursors
- **Multi-Session**: Handle concurrent monitoring

## Error Detection Intelligence

- **Pattern Matching**: Regex + command-specific analyzers
- **Rate Limiting**: Anti-spam with cooldown periods
- **Batch Processing**: Group related errors intelligently  
- **Context Extraction**: File paths, stack traces, suggestions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add your improvements
4. Test with multiple command types
5. Submit a pull request

## License

MIT License - feel free to use and modify for your needs!