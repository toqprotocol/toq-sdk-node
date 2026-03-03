# toq SDK for Node

Node/TypeScript SDK for [toq protocol](https://github.com/toqprotocol/toq). Thin client to the local toq daemon. Zero runtime dependencies.

## Install

```
npm install toq
```

## Prerequisites

1. Install the toq binary
2. Run `toq setup`
3. Run `toq up`

## Usage

```typescript
import { connect } from 'toq';

const client = connect();

// Send a message
await client.send('toq://peer.example.com/agent', 'hello');

// Receive messages
for await (const msg of client.messages()) {
    console.log(`From ${msg.from}: ${msg.body}`);
    await msg.reply('got it');
}
```

## API

| Method | Description |
|--------|-------------|
| `send(to, text)` | Send a message |
| `messages()` | Stream incoming messages (async generator) |
| `peers()` | List known peers |
| `block(key)` / `unblock(key)` | Block/unblock an agent |
| `approvals()` | List pending approvals |
| `approve(id)` / `deny(id)` | Resolve an approval |
| `discover(host)` / `discoverLocal()` | DNS/mDNS discovery |
| `connections()` | List active connections |
| `status()` / `health()` | Daemon status |
| `shutdown()` | Stop the daemon |
| `logs()` / `clearLogs()` | Read/clear logs |
| `diagnostics()` / `checkUpgrade()` | Diagnostics |
| `rotateKeys()` | Rotate identity keys |
| `exportBackup(passphrase)` | Create encrypted backup |
| `importBackup(passphrase, data)` | Restore from backup |
| `config()` / `updateConfig()` | Read/update config |
| `card()` | Get agent card |

## License

Apache 2.0
