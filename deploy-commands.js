require('dotenv').config();
const { REST, Routes } = require('discord.js');

console.log('🚀 Global Command Deployer Starting...');
console.log('🔧 Environment Check:');
console.log('DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN ? '✅ Set' : '❌ NOT SET');
console.log('CLIENT_ID:', process.env.CLIENT_ID ? '✅ Set' : '❌ NOT SET');

// USER-FACING COMMANDS ONLY - Available in ALL servers
const commands = [
  // 🎪 General Commands
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
        name: 'user', type: 6, description: 'The user to get info about', required: false
      }
    ]
  },
  {
    name: 'avatar',
    description: "Get a user's avatar",
    options: [
      {
        name: 'user', type: 6, description: 'The user to get the avatar of', required: false
      }
    ]
  },
  {
    name: 'membercount',
    description: 'Show the current member count'
  },

  // 🎵 Music Commands
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
        name: 'url', type: 3, description: 'YouTube URL to play', required: true
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
        name: 'volume', type: 4, description: 'Volume level (1-100)', required: true,
        min_value: 1, max_value: 100
      }
    ]
  },
  {
    name: 'nowplaying',
    description: 'Show the currently playing song'
  },

  // 📊 Leveling Commands
  {
    name: 'level',
    description: 'Check your level or another user\'s level',
    options: [
      {
        name: 'user', type: 6, description: 'The user to check level for', required: false
      }
    ]
  },
  {
    name: 'leaderboard',
    description: 'Show the server level leaderboard'
  }
];

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

// Validate environment variables
if (!token || !clientId) {
  console.error('❌ MISSING ENVIRONMENT VARIABLES:');
  if (!token) console.error('   - DISCORD_BOT_TOKEN is required');
  if (!clientId) console.error('   - CLIENT_ID is required');
  console.log('💡 Add these to your .env file or Render environment variables');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function deployGlobalCommands() {
  try {
    console.log('\n🔄 Deploying global commands to all servers...');
    console.log(`📝 Deploying ${commands.length} commands`);

    const data = await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );

    console.log(`✅ SUCCESS: Deployed ${data.length} global commands!`);
    
    console.log('\n🎯 Available Commands:');
    console.log('   🎵 Music: /play, /skip, /stop, /queue, /volume, /nowplaying');
    console.log('   📊 Leveling: /level, /leaderboard');
    console.log('   🎪 General: /ping, /help, /server-info, /user-info');
    
    console.log('\n⏰ Note: Global commands may take up to 1 hour to appear in all servers');
    console.log('🌐 Use /deploy-guild for instant testing in specific servers');
    
    return true;

  } catch (error) {
    console.error('❌ DEPLOYMENT FAILED:', error.message);
    
    // Helpful error messages
    switch (error.code) {
      case 50001:
        console.log('💡 Missing Access: Bot needs "applications.commands" scope');
        console.log('💡 Re-invite with: https://discord.com/oauth2/authorize?client_id=' + clientId + '&permissions=8&scope=bot%20applications.commands');
        break;
      case 50013:
        console.log('💡 Missing Permissions: Bot needs "Use Application Commands" permission');
        break;
      case 40060:
        console.log('💡 Too many commands: You have reached the 100 command limit');
        break;
      default:
        console.log('💡 Check your bot token and client ID are correct');
    }
    
    return false;
  }
}

// Handle process events
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Run deployment
deployGlobalCommands().then(success => {
  process.exit(success ? 0 : 1);
});