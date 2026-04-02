# Branch Manager

Webhook-based feature branch spawner for Node.js projects.

## Quick Start

```bash
npm install
pm2 start index.js --name branch-manager
```

## Configuration

Edit `projects.yaml` to add your projects:

```yaml
projects:
  myapp:
    repo: https://github.com/username/myapp.git
    env: .env.myapp
    defaultBranch: main
```

## Webhook

- **Port:** 9101
- **URL:** `POST http://<server>:9101/webhook`

Configure GitHub webhooks for push and pull request events.