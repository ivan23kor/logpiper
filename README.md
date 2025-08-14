# logpiper

[![npm]](https://www.npmjs.com/package/logpiper-mcp)

[npm]: https://img.shields.io/npm/v/logpiper-mcp.svg?style=flat-square

Logpiper is an MCP server and client for streaming terminal command logs with proactive error notifications

## Features

🚀 **Multi-Session Support**: Run multiple `logpiper` instances simultaneously across different terminals  
📊 **Real-time Streaming**: Only delivers new, unfetched logs via cursor-based streaming  
📢 **Proactive Notifications**: Automatic alerts to Claude Code  

## Installation

Install npm package `logpiper-mcp` to access both components:

```bash
npm install -g logpiper-mcp
```

This provides:
- **CLI tool**: `logpiper` command for log collection
- **MCP server**: `logpiper-mcp` for IDE integration
- **Claude Code agent**: Install the monitoring agent with `logpiper --install-agent`

### Agent Installation

To install the Claude Code monitoring agent:

```bash
logpiper --install-agent
```

This will interactively guide you through installing the logpiper-monitor agent to your Claude Code agents directory.

### MCP Server Configuration

Add `logpiper` to your IDE configuration, e.g. `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "logpiper": {
      "command": "logpiper-mcp"
    }
  }
}
```

## Usage

### 1. Start monitoring any command by prefixing it with `logpiper`:

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
| `get_new_logs` | Get new logs since cursor position (streaming) | Real-time log monitoring |
| `list_sessions` | List all logging sessions with metadata | Session management |
| `search_logs` | Search through logs with query string | Error investigation |
| `get_logs_paginated` | Get logs with cursor-based pagination and automatic chunking | Large log file navigation |
| `cleanup_sessions` | Cleanup sessions: smart cleanup based on criteria or complete reset | Session management (mode: "smart" or "all") |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add your improvements
4. Test with multiple command types
5. Submit a pull request

## License

MIT License - feel free to use and modify for your needs!