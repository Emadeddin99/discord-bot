# Discord Bot v3.0.0

A comprehensive Discord bot with music, moderation, auto-moderation, welcome system, and utility commands.

## Features

- 🎵 **Music System**: Play YouTube music in voice channels
- 🛡️ **Auto-Moderation**: Bilingual (English & Arabic) content filtering
- 👋 **Welcome System**: Customizable welcome messages and auto-roles
- ✅ **Verification System**: Button-based member verification
- 📜 **Rules System**: Manage and display server rules
- ⚡ **Slash Commands**: Modern Discord interaction system
- 🌐 **Health Checks**: HTTP endpoints for monitoring

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in your credentials
4. Deploy commands:
   - Global: `npm run deploy:global`
   - Guild (for testing): `npm run deploy:guild`
5. Start the bot: `npm start`

## Environment Variables

- `DISCORD_BOT_TOKEN`: Your Discord bot token
- `CLIENT_ID`: Your bot's client ID
- `GUILD_ID`: Your test server ID (for guild commands)
- `PORT`: Server port (default: 3000)

## Deployment

The bot is configured for deployment on Render.com. Make sure to set all environment variables in your Render dashboard.