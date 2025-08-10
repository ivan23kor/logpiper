# logpiper-mcp

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

### Installing the Log Monitor Guardian Agent

For automatic log monitoring with Claude Code, install the `log-monitor-guardian` agent by copying the `log-monitor-guardian.md` file to your Claude Code agents directory:
```bash
cp log-monitor-guardian.md ~/.claude/agents/
```

## Usage

### 1. Start the MCP Server

Configure Claude Code to use the LogPiper MCP server by adding to your `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "logpiper-mcp": {
      "command": "node",
      "args": ["cmd", "/c", "C:\\Users\\Ivan\\Desktop\\logpiper\\dist\\server.js"]
    }
  }
}
```

### 2. Use LogPiper CLI

Start monitoring any command by prefixing it with `logpiper`:

#### Testing and CI/CD
```bash
# Monitor test suites
logpiper npm test
logpiper npm run test:watch
logpiper npm run test:e2e

# Monitor build processes
logpiper npm run build
logpiper npm run build:prod
```

#### Docker and Container Monitoring
```bash
# Monitor Docker Compose services
logpiper docker-compose up
logpiper docker-compose logs -f backend

# Monitor individual containers
logpiper docker logs -f container_name
```

#### Database and Backend Services
```bash
# Monitor Python applications
logpiper python app.py
logpiper uvicorn main:app --reload

# Monitor Node.js servers
logpiper node server.js
logpiper nodemon app.js
```

### 3. MCP Tools Available

| Tool | Description | Usage |
|------|-------------|-------|
| `get_new_logs` | Stream new logs since cursor | Real-time log monitoring |
| `list_sessions` | List all logging sessions | Session management |  
| `get_session_info` | Get detailed session info | Debugging context |
| `search_logs` | Search through logs | Error investigation |
| `acknowledge_error` | Mark errors as seen | Error management |
| `get_error_history` | View recent errors | Error tracking |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add your improvements
4. Test with multiple command types
5. Submit a pull request

## License

MIT License - feel free to use and modify for your needs!