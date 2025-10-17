require('dotenv').config();
const { REST, Routes } = require('discord.js');

console.log('🔧 Command Deployer Starting...');
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
    description: 'Display or manage server rules',
    options: [
      {
        name: 'action',
        type: 3,
        description: 'Action to perform',
        required: true,
        choices: [
          { name: 'Display Rules', value: 'display' },
          { name: 'Set Rules Channel', value: 'setchannel' },
          { name: 'Add Rule', value: 'add' },
          { name: 'Remove Rule', value: 'remove' },
          { name: 'Clear All Rules', value: 'clear' }
        ]
      },
      {
        name: 'channel',
        type: 7,
        description: 'The channel to post rules in',
        required: false,
        channel_types: [0]
      },
      {
        name: 'rule',
        type: 3,
        description: 'The rule text to add or rule number to remove',
        required: false
      }
    ]
  },
  {
    name: 'verify',
    description: 'Set up verification system for your server',
    options: [
      {
        name: 'action',
        type: 3,
        description: 'Verification action',
        required: true,
        choices: [
          { name: 'Setup Verification', value: 'setup' },
          { name: 'Set Verified Role', value: 'setrole' },
          { name: 'Set Verification Channel', value: 'setchannel' },
          { name: 'Toggle Verification', value: 'toggle' },
          { name: 'View Settings', value: 'settings' }
        ]
      },
      {
        name: 'role',
        type: 8,
        description: 'Role to give verified members',
        required: false
      },
      {
        name: 'channel',
        type: 7,
        description: 'Channel for verification',
        required: false,
        channel_types: [0]
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
    console.log('📝 Commands deployed:');
    data.forEach(cmd => {
      console.log(`   - /${cmd.name}: ${cmd.description}`);
    });
    
    console.log('🎉 Your bot commands are now live! It may take up to 1 hour to appear in all servers.');
  } catch (error) {
    console.error('❌ Error deploying commands:', error);
    
    // Helpful error messages
    if (error.code === 50001) {
      console.log('💡 Missing Access: Make sure your bot is invited to the server with applications.commands scope');
    } else if (error.code === 50013) {
      console.log('💡 Missing Permissions: Check your bot has the necessary permissions');
    } else if (error.code === 40060) {
      console.log('💡 Too many application commands: You have reached the limit of 100 commands');
    } else if (error.code === 40041) {
      console.log('💡 Invalid OAuth2 application: Check your CLIENT_ID is correct');
    }
    
    process.exit(1);
  }
}

deployCommands();