require('dotenv').config();
const { REST, Routes } = require('discord.js');

console.log('⚡ Guild Command Deployer Starting...');
console.log('🔧 Environment Check:');
console.log('DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN ? '✅ Set' : '❌ NOT SET');
console.log('CLIENT_ID:', process.env.CLIENT_ID ? '✅ Set' : '❌ NOT SET');
console.log('GUILD_ID:', process.env.GUILD_ID ? '✅ Set' : '❌ NOT SET');

// ADMIN/CONFIGURATION COMMANDS ONLY - For testing and setup
// Updated to match your main code capabilities
const commands = [
  // ⚙️ Setup Commands (simplified to match your main code)
  {
    name: 'setup-basic',
    description: 'Set up basic bot features for this server',
    options: [
      {
        name: 'welcome_channel', type: 7, description: 'Channel for welcome messages', required: false, channel_types: [0]
      },
      {
        name: 'goodbye_channel', type: 7, description: 'Channel for goodbye messages', required: false, channel_types: [0]
      },
      {
        name: 'auto_role', type: 8, description: 'Role to assign to new members', required: false
      }
    ]
  },

  // 🛡️ Moderation Commands (basic ones that could work with your current structure)
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

  // 📋 System Configuration (matching your main code)
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
    name: 'setautorole',
    description: 'Set the auto-role for new members',
    options: [
      {
        name: 'role', type: 8, description: 'Role to assign to new members', required: true
      }
    ]
  },
  {
    name: 'togglewelcome',
    description: 'Toggle welcome messages on/off',
    options: [
      {
        name: 'enabled', type: 5, description: 'Enable or disable welcome messages', required: true
      }
    ]
  },
  {
    name: 'config',
    description: 'View the current bot configuration'
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
    console.log('   ⚙️  Setup: /setup-basic, /setautorole, /togglewelcome');
    console.log('   🛡️  Moderation: /clear, /slowmode');
    console.log('   📋 System: /setwelcome, /setgoodbye, /config');
    
    console.log('\n💡 Usage Tips:');
    console.log('   • Commands appear INSTANTLY (no 1-hour wait)');
    console.log('   • Perfect for testing and configuration');
    console.log('   • Use /setup-basic to configure multiple features at once');
    
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