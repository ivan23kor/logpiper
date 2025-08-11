# logpiper

[![npm]](https://www.npmjs.com/package/logpiper-mcp)

[npm]: https://img.shields.io/npm/v/logpiper-mcp.svg?style=flat-square

Logpiper is an MCP server and client for streaming terminal command logs with proactive error notifications

## Features

🚀 **Multi-Session Support**: Run multiple `logpiper` instances simultaneously across different terminals  
📊 **Real-time Streaming**: Only delivers new, unfetched logs via cursor-based streaming  
📢 **Proactive Notifications**: Automatic alerts to Claude Code  

## Installation

Install `logpiper` to access both components:

```bash
npm install -g logpiper
```

This provides:
- **CLI tool**: `logpiper` command for log collection
- **MCP server**: `logpiper-mcp` for IDE integration
- **Claude Code agent**: installation script will offer to install `log-monitor-guardian` agent to your Claude Code agents directory for automatic log monitoring with Claude Code.

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
| `get_session_info` | Get detailed information about specific session | Debugging context |
| `search_logs` | Search through logs with query string | Error investigation |
| `acknowledge_error` | Mark an error as acknowledged | Error management |
| `get_error_history` | Get recent errors for a session | Error tracking |
| `get_logs_paginated` | Get logs with cursor-based pagination and automatic chunking | Large log file navigation |
| `get_recent_logs` | Get recent logs (latest first) with pagination | Quick access to latest logs |
| `reset_all_sessions` | Reset all sessions and logs - completely clears all LogPiper data | Complete cleanup |
| `reset_session` | Reset a specific session - removes session and its logs | Individual session cleanup |
| `clear_session_logs` | Clear logs for session while keeping session metadata | Log cleanup only |
| `reset_sessions_by_criteria` | Reset sessions matching specific criteria | Selective cleanup |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add your improvements
4. Test with multiple command types
5. Submit a pull request

## License

MIT License - feel free to use and modify for your needs!