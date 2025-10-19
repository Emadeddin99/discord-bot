require('dotenv').config();
const { REST, Routes } = require('discord.js');

console.log('🔧 Global Command Deployer Starting...');
console.log('Environment Check:');
console.log('DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN ? '***' : 'NOT SET');
console.log('CLIENT_ID:', process.env.CLIENT_ID || 'NOT SET');

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
    name: 'server-info',
    description: 'Get detailed server information'
  },
  {
    name: 'user-info',
    description: 'Get information about a user',
    options: [
      {
        name: 'user',
        type: 6,
        description: 'The user to get info about',
        required: false
      }
    ]
  },
  {
    name: 'avatar',
    description: "Get a user's avatar",
    options: [
      {
        name: 'user',
        type: 6,
        description: 'The user to get the avatar of',
        required: false
      }
    ]
  },
  {
    name: 'membercount',
    description: 'Show the current member count'
  },
  {
    name: 'join',
    description: 'Join your voice channel'
  },
  {
    name: 'leave',
    description: 'Leave the voice channel'
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
    name: 'setwelcome',
    description: 'Set the welcome channel for this server',
    options: [
      {
        name: 'channel',
        type: 7,
        description: 'The channel to send welcome messages to',
        required: true,
        channel_types: [0]
      },
      {
        name: 'message',
        type: 3,
        description: 'Custom welcome message (use {user} for mention, {server} for server name, {count} for member count)',
        required: false
      }
    ]
  },
  {
    name: 'setgoodbye',
    description: 'Set the goodbye channel for this server',
    options: [
      {
        name: 'channel',
        type: 7,
        description: 'The channel to send goodbye messages to',
        required: true,
        channel_types: [0]
      },
      {
        name: 'message',
        type: 3,
        description: 'Custom goodbye message (use {user} for mention, {server} for server name, {count} for member count)',
        required: false
      }
    ]
  },
  {
    name: 'config',
    description: 'View the current bot configuration'
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
    name: 'slowmode',
    description: 'Set slowmode for the current channel',
    options: [
      {
        name: 'seconds',
        type: 4,
        description: 'Slowmode duration in seconds (0-21600)',
        required: true,
        min_value: 0,
        max_value: 21600
      }
    ]
  },
  {
    name: 'rules',
    description: 'Manage server rules',
    options: [
      {
        name: 'action',
        type: 3,
        description: 'Action to perform',
        required: true,
        choices: [
          { name: 'Add', value: 'add' },
          { name: 'Remove', value: 'remove' },
          { name: 'List', value: 'list' },
          { name: 'Set Channel', value: 'setchannel' },
          { name: 'Clear', value: 'clear' },
          { name: 'Post', value: 'post' }
        ]
      },
      {
        name: 'text',
        type: 3,
        description: 'Rule text (for add)',
        required: false
      },
      {
        name: 'index',
        type: 4,
        description: 'Rule index (for remove)',
        required: false
      },
      {
        name: 'channel',
        type: 7,
        description: 'Channel to post rules or set as rules channel',
        required: false,
        channel_types: [0]
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
  },
  {
    name: 'setup-verification',
    description: 'Set up verification system for new members',
    options: [
      {
        name: 'channel',
        type: 7,
        description: 'Channel for verification',
        required: true,
        channel_types: [0]
      },
      {
        name: 'role',
        type: 8,
        description: 'Role to assign after verification',
        required: true
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
    name: 'warnings',
    description: 'Check warnings for a user',
    options: [
      {
        name: 'user',
        type: 6,
        description: 'The user to check warnings for',
        required: false
      }
    ]
  },
  {
    name: 'clearwarnings',
    description: 'Clear all warnings for a user',
    options: [
      {
        name: 'user',
        type: 6,
        description: 'The user to clear warnings for',
        required: true
      }
    ]
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
    name: 'leveling-setup',
    description: 'Set up the leveling system for this server',
    options: [
      {
        name: 'channel',
        type: 7,
        description: 'Channel for level-up notifications',
        required: false,
        channel_types: [0]
      },
      {
        name: 'member_role',
        type: 8,
        description: 'Role to assign at member level',
        required: false
      },
      {
        name: 'shadow_role',
        type: 8,
        description: 'Role to assign at shadow level',
        required: false
      },
      {
        name: 'member_threshold',
        type: 4,
        description: 'Level required for member role (default: 10)',
        required: false,
        min_value: 1
      },
      {
        name: 'shadow_threshold',
        type: 4,
        description: 'Level required for shadow role (default: 25)',
        required: false,
        min_value: 1
      }
    ]
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
  }
];

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token) {
  console.error('❌ ERROR: DISCORD_BOT_TOKEN is not set in environment variables!');
  console.log('💡 Please set your Discord bot token in the .env file');
  process.exit(1);
}

if (!clientId) {
  console.error('❌ ERROR: CLIENT_ID is not set in environment variables!');
  console.log('💡 Please set your Discord client ID in the .env file');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function deployCommands() {
  try {
    console.log('🔄 Started refreshing application (/) commands.');

    const data = await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );

    console.log(`✅ Successfully reloaded ${data.length} application (/) commands.`);
    
    console.log('\n🎵 Music Commands:');
    console.log('   - /join - Join your voice channel');
    console.log('   - /leave - Leave the voice channel');
    console.log('   - /play - Play music from YouTube');
    console.log('   - /skip - Skip current song');
    console.log('   - /stop - Stop music and clear queue');
    console.log('   - /queue - Show music queue');
    console.log('   - /volume - Set music volume');
    console.log('   - /nowplaying - Show current song');
    
    console.log('\n📊 Leveling Commands:');
    console.log('   - /level - Check your level');
    console.log('   - /leaderboard - Server leaderboard');
    console.log('   - /leveling-setup - Configure leveling');
    
    console.log('\n🛡️ Moderation Commands:');
    console.log('   - /warn - Warn a user');
    console.log('   - /warnings - Check warnings');
    console.log('   - /clearwarnings - Clear warnings');
    console.log('   - /automod - Auto-moderation settings');
    console.log('   - /clear - Clear messages');
    console.log('   - /slowmode - Set slowmode');
    
    console.log('\n⚙️ Admin Commands:');
    console.log('   - /setup-automated - One-click setup');
    console.log('   - /setwelcome - Set welcome channel');
    console.log('   - /setgoodbye - Set goodbye channel');
    console.log('   - /config - View configuration');
    console.log('   - /rules - Manage server rules');
    console.log('   - /setup-verification - Verification system');
    
    console.log('\n🎪 General Commands:');
    console.log('   - /ping - Check bot latency');
    console.log('   - /help - Show all commands');
    console.log('   - /server-info - Server information');
    console.log('   - /user-info - User information');
    console.log('   - /avatar - Get user avatar');
    console.log('   - /membercount - Member count');
    
    console.log('\n🎉 Your bot commands are now live in all servers!');
    console.log('⏰ It may take up to 1 hour to appear everywhere.');
    
  } catch (error) {
    console.error('❌ Error deploying commands:', error.message);
    
    if (error.code === 50001) {
      console.log('💡 Missing Access: Make sure your bot is invited to the server with applications.commands scope');
    } else if (error.code === 50013) {
      console.log('💡 Missing Permissions: Check your bot has the necessary permissions');
    } else if (error.code === 40060) {
      console.log('💡 Too many application commands: You have reached the limit of 100 commands');
      console.log('💡 Try removing some unused commands');
    } else if (error.code === 50035) {
      console.log('�️ Invalid Form Body: Check your command options for errors');
    }
    
    process.exit(1);
  }
}

// Handle process events
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

deployCommands();