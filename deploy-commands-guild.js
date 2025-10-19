require('dotenv').config();
const { REST, Routes } = require('discord.js');

console.log('⚡ Guild Command Deployer Starting...');
console.log('🔧 Environment Check:');
console.log('DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN ? '✅ Set' : '❌ NOT SET');
console.log('CLIENT_ID:', process.env.CLIENT_ID ? '✅ Set' : '❌ NOT SET');
console.log('GUILD_ID:', process.env.GUILD_ID ? '✅ Set' : '❌ NOT SET');

// ADMIN/CONFIGURATION COMMANDS ONLY - For testing and setup
const commands = [
  // ⚙️ Setup Commands
  {
    name: 'setup-welcome',
    description: 'Set up welcome and goodbye system',
    options: [
      {
        name: 'welcome_channel', type: 7, description: 'Channel for welcome messages', required: true, channel_types: [0]
      },
      {
        name: 'goodbye_channel', type: 7, description: 'Channel for goodbye messages', required: false, channel_types: [0]
      },
      {
        name: 'mod_channel', type: 7, description: 'Channel for moderation logs', required: false, channel_types: [0]
      }
    ]
  },

  // 🛡️ Moderation Commands
  {
    name: 'warn',
    description: 'Warn a user for rule violation',
    options: [
      { name: 'user', type: 6, description: 'The user to warn', required: true },
      { name: 'reason', type: 3, description: 'Reason for the warning', required: true }
    ]
  },
  {
    name: 'clearwarnings',
    description: 'Clear all warnings for a user',
    options: [
      { name: 'user', type: 6, description: 'The user to clear warnings for', required: true }
    ]
  },
  {
    name: 'clear',
    description: 'Clear messages from a channel',
    options: [
      {
        name: 'amount', type: 4, description: 'Number of messages to clear (1-100)', required: true,
        min_value: 1, max_value: 100
      }
    ]
  },
  {
    name: 'slowmode',
    description: 'Set slowmode for the current channel',
    options: [
      {
        name: 'seconds', type: 4, description: 'Slowmode duration in seconds (0-21600)', required: true,
        min_value: 0, max_value: 21600
      }
    ]
  },

  // 📋 System Configuration
  {
    name: 'setwelcome',
    description: 'Set the welcome channel for this server',
    options: [
      {
        name: 'channel', type: 7, description: 'The channel to send welcome messages to', required: true, channel_types: [0]
      },
      {
        name: 'message', type: 3, description: 'Custom welcome message (use {user} for mention, {server} for server name, {count} for member count)', required: false
      }
    ]
  },
  {
    name: 'setgoodbye',
    description: 'Set the goodbye channel for this server',
    options: [
      {
        name: 'channel', type: 7, description: 'The channel to send goodbye messages to', required: true, channel_types: [0]
      },
      {
        name: 'message', type: 3, description: 'Custom goodbye message (use {user} for mention, {server} for server name, {count} for member count)', required: false
      }
    ]
  },
  {
    name: 'setmodchannel',
    description: 'Set the moderation log channel',
    options: [
      {
        name: 'channel', type: 7, description: 'The channel to send moderation logs to', required: true, channel_types: [0]
      }
    ]
  }
];

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

// Validate environment variables
if (!token || !clientId || !guildId) {
  console.error('❌ MISSING ENVIRONMENT VARIABLES:');
  if (!token) console.error('   - DISCORD_BOT_TOKEN is required');
  if (!clientId) console.error('   - CLIENT_ID is required');
  if (!guildId) console.error('   - GUILD_ID is required');
  console.log('💡 Add these to your .env file or Render environment variables');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function deployGuildCommands() {
  try {
    console.log(`\n🔄 Deploying guild commands to server: ${guildId}`);
    console.log(`📝 Deploying ${commands.length} admin commands`);

    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );

    console.log(`✅ SUCCESS: Deployed ${data.length} guild commands!`);
    console.log(`🎯 Commands available in server: ${guildId}`);
    
    console.log('\n⚡ Admin Commands Available:');
    console.log('   ⚙️  Setup: /setup-welcome');
    console.log('   🛡️  Moderation: /warn, /clearwarnings, /clear, /slowmode');
    console.log('   📋 System: /setwelcome, /setgoodbye, /setmodchannel');
    
    console.log('\n💡 Usage Tips:');
    console.log('   • Commands appear INSTANTLY (no 1-hour wait)');
    console.log('   • Perfect for testing and configuration');
    console.log('   • Use /setup-welcome to configure everything at once');
    
    return true;

  } catch (error) {
    console.error('❌ GUILD DEPLOYMENT FAILED:', error.message);
    
    // Helpful error messages
    switch (error.code) {
      case 50001:
        console.log('💡 Missing Access: Bot is not in the specified server');
        console.log('💡 Invite bot to server first');
        break;
      case 50013:
        console.log('💡 Missing Permissions: Bot needs "Use Application Commands" permission');
        break;
      case 10004:
        console.log('💡 Unknown Guild: GUILD_ID is incorrect');
        console.log('💡 Get your server ID: Server Settings → Widget → Server ID');
        break;
      default:
        console.log('💡 Check your GUILD_ID and ensure bot is in the server');
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
deployGuildCommands().then(success => {
  process.exit(success ? 0 : 1);
});