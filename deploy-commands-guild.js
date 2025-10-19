require('dotenv').config();
const { REST, Routes } = require('discord.js');

console.log('🔧 Guild Command Deployer Starting...');
console.log('Environment Check:');
console.log('DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN ? '***' : 'NOT SET');
console.log('CLIENT_ID:', process.env.CLIENT_ID || 'NOT SET');
console.log('GUILD_ID:', process.env.GUILD_ID || 'NOT SET');

// Select only essential commands for guild deployment
const commands = [
  {
    name: 'ping',
    description: "Check the bot's latency"
  },
  {
    name: 'help',
    description: 'Show all available commands'
  },
  {
    name: 'setup-automated',
    description: 'Set up all automated systems with one command',
    options: [
      {
        name: 'level_channel',
        type: 7,
        description: 'Channel for level-up notifications',
        required: true,
        channel_types: [0]
      },
      {
        name: 'music_channel',
        type: 7,
        description: 'Channel for music commands',
        required: false,
        channel_types: [0]
      },
      {
        name: 'log_channel',
        type: 7,
        description: 'Channel for moderation logs',
        required: false,
        channel_types: [0]
      },
      {
        name: 'new_role',
        type: 8,
        description: 'Role for new members (Level 1)',
        required: false
      },
      {
        name: 'member_role',
        type: 8,
        description: 'Role for members (Level 10)',
        required: false
      },
      {
        name: 'shadow_role',
        type: 8,
        description: 'Role for shadows (Level 25)',
        required: false
      }
    ]
  },
  {
    name: 'play',
    description: 'Play music from a YouTube URL',
    options: [
      {
        name: 'url',
        type: 3,
        description: 'YouTube URL to play',
        required: true
      }
    ]
  },
  {
    name: 'skip',
    description: 'Skip the current song'
  },
  {
    name: 'stop',
    description: 'Stop the music and clear the queue'
  },
  {
    name: 'queue',
    description: 'Show the current music queue'
  },
  {
    name: 'volume',
    description: 'Set the music volume',
    options: [
      {
        name: 'volume',
        type: 4,
        description: 'Volume level (1-100)',
        required: true,
        min_value: 1,
        max_value: 100
      }
    ]
  },
  {
    name: 'nowplaying',
    description: 'Show the currently playing song'
  },
  {
    name: 'level',
    description: 'Check your level or another user\'s level',
    options: [
      {
        name: 'user',
        type: 6,
        description: 'The user to check level for',
        required: false
      }
    ]
  },
  {
    name: 'leaderboard',
    description: 'Show the server level leaderboard'
  },
  {
    name: 'clear',
    description: 'Clear messages from a channel',
    options: [
      {
        name: 'amount',
        type: 4,
        description: 'Number of messages to clear (1-100)',
        required: true,
        min_value: 1,
        max_value: 100
      }
    ]
  },
  {
    name: 'warn',
    description: 'Warn a user for rule violation',
    options: [
      {
        name: 'user',
        type: 6,
        description: 'The user to warn',
        required: true
      },
      {
        name: 'reason',
        type: 3,
        description: 'Reason for the warning',
        required: true
      }
    ]
  },
  {
    name: 'automod',
    description: 'Configure auto moderation',
    options: [
      {
        name: 'action',
        type: 3,
        description: 'What automod should do',
        required: true,
        choices: [
          { name: 'Toggle', value: 'toggle' },
          { name: 'Status', value: 'status' },
          { name: 'Set Action', value: 'setaction' },
          { name: 'Set Log Channel', value: 'setlog' },
          { name: 'Add Word', value: 'addword' },
          { name: 'Remove Word', value: 'removeword' },
          { name: 'List Words', value: 'listwords' }
        ]
      },
      {
        name: 'value',
        type: 3,
        description: 'Value for setaction (warn/mute/kick/ban) or word to add/remove',
        required: false
      },
      {
        name: 'channel',
        type: 7,
        description: 'Channel for moderation logs',
        required: false,
        channel_types: [0]
      }
    ]
  }
];

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token) {
  console.error('❌ ERROR: DISCORD_BOT_TOKEN is not set in environment variables!');
  process.exit(1);
}

if (!clientId) {
  console.error('❌ ERROR: CLIENT_ID is not set in environment variables!');
  process.exit(1);
}

if (!guildId) {
  console.error('❌ ERROR: GUILD_ID is not set in environment variables!');
  console.log('💡 Add GUILD_ID=your_server_id to your .env file');
  console.log('💡 You can get your server ID by enabling Developer Mode in Discord');
  console.log('💡 Right-click your server → Copy Server ID');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function deployGuildCommands() {
  try {
    console.log(`🔄 Started refreshing guild (/) commands for server ${guildId}.`);

    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );

    console.log(`✅ Successfully reloaded ${data.length} guild (/) commands.`);
    console.log(`🎯 Commands deployed to server: ${guildId}`);
    
    console.log('\n🚀 Quick-Deploy Commands:');
    console.log('   - /setup-automated - One-click setup for all systems');
    console.log('   - /play - Start playing music immediately');
    console.log('   - /level - Check leveling system');
    console.log('   - /automod - Configure moderation');
    
    console.log('\n⚡ Benefits of Guild Deployment:');
    console.log('   • Instant command updates (no 1-hour wait)');
    console.log('   • Perfect for development and testing');
    console.log('   • Server-specific command sets');
    console.log('   • Avoid global command limits');
    
    console.log('\n💡 Usage Tips:');
    console.log('   • Use this for testing new commands');
    console.log('   • Keep global deploy for production');
    console.log('   • Commands appear instantly in your server');
    
  } catch (error) {
    console.error('❌ Error deploying guild commands:', error.message);
    
    if (error.code === 50001) {
      console.log('💡 Missing Access: Make sure your bot is in the server');
    } else if (error.code === 50013) {
      console.log('💡 Missing Permissions: Bot needs permission to create commands');
    } else if (error.code === 10004) {
      console.log('💡 Unknown Guild: Check your GUILD_ID is correct');
    }
    
    process.exit(1);
  }
}

deployGuildCommands();