require('dotenv').config();
const { REST, Routes } = require('discord.js');

console.log('🔧 Guild Command Deployer Starting...');

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
  console.log('💡 Add GUILD_ID=your_server_id to your .env file for testing');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

// Complete commands list with all new features
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
    name: 'spotify',
    description: 'Spotify music bot controls',
    options: [
      {
        name: 'action',
        type: 3,
        description: 'Action to perform',
        required: true,
        choices: [
          { name: 'Join', value: 'join' },
          { name: 'Leave', value: 'leave' },
          { name: 'Auto-Join', value: 'autojoin' },
          { name: 'Set Channel', value: 'setchannel' },
          { name: 'Status', value: 'status' }
        ]
      },
      {
        name: 'channel',
        type: 7,
        description: 'Voice channel for Spotify bot',
        required: false,
        channel_types: [2]
      }
    ]
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
    name: 'play',
    description: 'Play music from a YouTube URL or search term',
    options: [
      {
        name: 'query',
        type: 3,
        description: 'YouTube URL or song name to play',
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
        name: 'level',
        type: 4,
        description: 'Volume level (1-100)',
        required: true,
        min_value: 1,
        max_value: 100
      }
    ]
  }
];

async function deployGuildCommands() {
  try {
    console.log(`🔄 Deploying commands to guild: ${guildId}`);
    
    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );

    console.log(`✅ Successfully deployed ${data.length} commands to guild.`);
    console.log('📝 Guild commands deployed:');
    data.forEach(cmd => {
      console.log(`   - /${cmd.name}: ${cmd.description}`);
    });
    
    console.log('\n🎉 Guild commands deployed successfully!');
    console.log('🚀 These commands will appear immediately in your test server.');
    console.log('\n🔧 New Features Available:');
    console.log('   🎵 Music System: /play, /skip, /stop, /queue, /volume');
    console.log('   📊 Leveling System: /level, /leaderboard, /leveling-setup');
    console.log('   🛡️ Enhanced Moderation: /warn, /warnings, /clearwarnings');
    console.log('   👋 Goodbye Messages: /setgoodbye');
    console.log('   ⚙️ Auto-Moderation: /automod');
    console.log('   📜 Rules System: /rules');
    console.log('   🔐 Verification: /setup-verification');
    
  } catch (error) {
    console.error('❌ Error deploying guild commands:', error.message);
    
    if (error.code === 50001) {
      console.log('💡 Missing Access: Bot not in the specified guild');
      console.log('💡 Make sure your bot is invited to the server with ID:', guildId);
    } else if (error.code === 50013) {
      console.log('💡 Missing Permissions: Bot lacks permissions in the guild');
      console.log('💡 Re-invite bot with proper permissions');
    } else if (error.code === 10004) {
      console.log('💡 Unknown Guild: Check your GUILD_ID is correct');
      console.log('💡 Current GUILD_ID:', guildId);
    } else if (error.code === 40060) {
      console.log('💡 Too many commands: You have reached the limit');
      console.log('💡 Try removing some unused commands');
    }
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

deployGuildCommands();