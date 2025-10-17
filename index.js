// Load environment variables FIRST
require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const fs = require('fs').promises;
const path = require('path');
const express = require('express');

// Initialize Express for health checks
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ]
});

// Command handler
client.commands = new Collection();

// Configuration storage
const configPath = path.join(__dirname, 'config.json');
let serverConfigs = {};

// Voice connection storage
const voiceConnections = new Map();
const audioPlayers = new Map();

// Load configuration
async function loadConfig() {
  try {
    const data = await fs.readFile(configPath, 'utf8');
    serverConfigs = JSON.parse(data);
    console.log('✅ Configuration loaded successfully');
  } catch (error) {
    console.log('⚠️ No existing configuration found, starting fresh');
    serverConfigs = {};
  }
}

// Save configuration
async function saveConfig() {
  try {
    await fs.writeFile(configPath, JSON.stringify(serverConfigs, null, 2));
    console.log('💾 Configuration saved');
  } catch (error) {
    console.error('❌ Failed to save configuration:', error);
  }
}

// Get server config
function getServerConfig(guildId) {
  if (!serverConfigs[guildId]) {
    serverConfigs[guildId] = {
      welcomeChannel: null,
      goodbyeChannel: null,
      welcomeMessage: null,
      goodbyeMessage: null,
      autoRole: null,
      enableWelcome: true,
      enableGoodbye: true,
      enableDMs: true,
      spotifyAutoJoin: false,
      spotifyChannel: null,
      spotifyPlaylist: null,
      rules: [],
      rulesChannel: null,
      verification: {
        enabled: false,
        role: null,
        channel: null,
        messageId: null
      }
    };
  }
  return serverConfigs[guildId];
}

// Spotify music function (placeholder)
function createSpotifyStream() {
  // Placeholder - implement actual Spotify streaming
  // For now, create a silent audio resource
  return createAudioResource(path.join(__dirname, 'assets/silent.mp3'));
}

// Join voice channel function
async function joinVoice(guildId, channelId) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return null;

    // Create voice connection
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });

    // Create audio player
    const player = createAudioPlayer();
    audioPlayers.set(guildId, player);

    // Handle connection events
    connection.on(VoiceConnectionStatus.Ready, () => {
      console.log(`🔊 Joined voice channel: ${channel.name} in ${guild.name}`);
      connection.subscribe(player);

      // Start playing Spotify stream
      const resource = createSpotifyStream();
      player.play(resource);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch (error) {
        connection.destroy();
        voiceConnections.delete(guildId);
        audioPlayers.delete(guildId);
        console.log(`🔊 Disconnected from voice channel in ${guild.name}`);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      voiceConnections.delete(guildId);
      audioPlayers.delete(guildId);
      console.log(`🔊 Connection destroyed in ${guild.name}`);
    });

    voiceConnections.set(guildId, connection);
    return connection;

  } catch (error) {
    console.error('❌ Error joining voice channel:', error);
    return null;
  }
}

// Leave voice channel function
function leaveVoice(guildId) {
  const connection = voiceConnections.get(guildId);
  const player = audioPlayers.get(guildId);

  if (player) {
    player.stop();
    audioPlayers.delete(guildId);
  }

  if (connection) {
    connection.destroy();
    voiceConnections.delete(guildId);
    console.log(`🔊 Left voice channel in guild ${guildId}`);
    return true;
  }

  return false;
}

// Command definitions
const commands = [
  {
    name: 'ping',
    description: "Check the bot's latency",
    async execute(interaction) {
      const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      const apiLatency = Math.round(client.ws.ping);

      const embed = new EmbedBuilder()
        .setTitle('🏓 Pong!')
        .setColor(0x00FF00)
        .addFields(
          { name: '🤖 Bot Latency', value: `${latency}ms`, inline: true },
          { name: '📡 API Latency', value: `${apiLatency}ms`, inline: true },
          { name: '💓 Heartbeat', value: `${client.ws.ping}ms`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ content: null, embeds: [embed] });
    }
  },
  {
    name: 'help',
    description: 'Show all available commands',
    async execute(interaction) {
      const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Help Menu')
        .setColor(0x3498DB)
        .setDescription('Here are all available commands!')
        .addFields(
          { name: '🎪 General', value: '`/ping`, `/help`, `/server-info`, `/user-info`, `/avatar`, `/membercount`', inline: true },
          { name: '🛠️ Moderation', value: '`/clear`, `/slowmode`', inline: true },
          { name: '⚙️ Admin', value: '`/setwelcome`, `/config`, `/spotify`', inline: true }
        )
        .setFooter({ text: 'Use slash commands (/) to interact with the bot!' });

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'server-info',
    description: 'Get detailed server information',
    async execute(interaction) {
      const guild = interaction.guild;
      const owner = await guild.fetchOwner();

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${guild.name} - Server Info`)
        .setColor(0x00FF00)
        .setThumbnail(guild.iconURL())
        .addFields(
          { name: '👥 Total Members', value: `${guild.memberCount}`, inline: true },
          { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '🆔 Server ID', value: guild.id, inline: true },
          { name: '👑 Owner', value: `${owner.user.tag}`, inline: true },
          { name: '📈 Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
          { name: '🎨 Boost Level', value: `Level ${guild.premiumTier}`, inline: true },
          { name: '🔢 Channels', value: `${guild.channels.cache.size}`, inline: true },
          { name: '🎭 Roles', value: `${guild.roles.cache.size}`, inline: true },
          { name: '😄 Emojis', value: `${guild.emojis.cache.size}`, inline: true }
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
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
    ],
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const member = interaction.guild.members.cache.get(user.id);

      if (!member) {
        return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
      }

      const roles = member.roles.cache
        .filter(role => role.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(role => role.toString())
        .slice(0, 10)
        .join(', ') || 'None';

      const embed = new EmbedBuilder()
        .setTitle(`👤 User Info - ${user.tag}`)
        .setColor(member.displayHexColor || 0x0099FF)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: '🆔 User ID', value: user.id, inline: true },
          { name: '📛 Nickname', value: member.nickname || 'None', inline: true },
          { name: '🤖 Bot', value: user.bot ? 'Yes' : 'No', inline: true },
          { name: '📅 Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '📅 Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
          { name: `🎭 Roles (${member.roles.cache.size - 1})`, value: roles.length > 1024 ? 'Too many roles to display' : roles, inline: false }
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
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
    ],
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;

      const embed = new EmbedBuilder()
        .setTitle(`🖼️ ${user.username}'s Avatar`)
        .setColor(0x3498DB)
        .setImage(user.displayAvatarURL({ size: 4096, dynamic: true }))
        .addFields(
          { name: '🔗 PNG', value: `[Link](${user.displayAvatarURL({ format: 'png', size: 4096 })})`, inline: true },
          { name: '🔗 JPEG', value: `[Link](${user.displayAvatarURL({ format: 'jpeg', size: 4096 })})`, inline: true },
          { name: '🔗 WebP', value: `[Link](${user.displayAvatarURL({ format: 'webp', size: 4096 })})`, inline: true }
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` });

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'membercount',
    description: 'Show the current member count',
    async execute(interaction) {
      const guild = interaction.guild;
      const totalMembers = guild.memberCount;
      const humans = guild.members.cache.filter(member => !member.user.bot).size;
      const bots = guild.members.cache.filter(member => member.user.bot).size;
      const online = guild.members.cache.filter(member => member.presence?.status === 'online').size;
      const idle = guild.members.cache.filter(member => member.presence?.status === 'idle').size;
      const dnd = guild.members.cache.filter(member => member.presence?.status === 'dnd').size;

      const embed = new EmbedBuilder()
        .setTitle(`👥 ${guild.name} - Member Count`)
        .setColor(0x9B59B6)
        .addFields(
          { name: '👤 Total Members', value: `${totalMembers}`, inline: true },
          { name: '😊 Humans', value: `${humans}`, inline: true },
          { name: '🤖 Bots', value: `${bots}`, inline: true },
          { name: '🟢 Online', value: `${online}`, inline: true },
          { name: '🟡 Idle', value: `${idle}`, inline: true },
          { name: '🔴 Do Not Disturb', value: `${dnd}`, inline: true }
        )
        .setThumbnail(guild.iconURL())
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
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
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel');
      const customMessage = interaction.options.getString('message');
      const config = getServerConfig(interaction.guild.id);

      config.welcomeChannel = channel.id;
      if (customMessage) config.welcomeMessage = customMessage;

      await saveConfig();

      const embed = new EmbedBuilder()
        .setTitle('✅ Welcome Channel Set')
        .setColor(0x00FF00)
        .addFields(
          { name: 'Channel', value: `${channel}`, inline: true },
          { name: 'Custom Message', value: customMessage || 'Using default message', inline: true }
        )
        .setFooter({ text: 'Welcome messages will now be sent to this channel' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'config',
    description: 'View the current bot configuration',
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', ephemeral: true });
      }

      const config = getServerConfig(interaction.guild.id);
      const welcomeChannel = config.welcomeChannel ? `<#${config.welcomeChannel}>` : 'Not set';
      const goodbyeChannel = config.goodbyeChannel ? `<#${config.goodbyeChannel}>` : 'Not set';
      const autoRole = config.autoRole ? `<@&${config.autoRole}>` : 'Not set';
      const spotifyChannel = config.spotifyChannel ? `<#${config.spotifyChannel}>` : 'Not set';
      const isSpotifyConnected = voiceConnections.has(interaction.guild.id);

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Server Configuration')
        .setColor(0x3498DB)
        .addFields(
          { name: '👋 Welcome Channel', value: welcomeChannel, inline: true },
          { name: '👋 Goodbye Channel', value: goodbyeChannel, inline: true },
          { name: '🔰 Auto Role', value: autoRole, inline: true },
          { name: '🎵 Spotify Channel', value: spotifyChannel, inline: true },
          { name: '🤖 Spotify Connected', value: isSpotifyConnected ? '✅ Yes' : '❌ No', inline: true },
          { name: '🔄 Spotify Auto-Join', value: config.spotifyAutoJoin ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: '📨 Welcome DMs', value: config.enableDMs ? 'Enabled' : 'Disabled', inline: true },
          { name: '🎉 Welcome Messages', value: config.enableWelcome ? 'Enabled' : 'Disabled', inline: true },
          { name: '👋 Goodbye Messages', value: config.enableGoodbye ? 'Enabled' : 'Disabled', inline: true }
        )
        .setFooter({ text: `Server ID: ${interaction.guild.id}` })
        .setTimestamp();

      if (config.welcomeMessage) {
        embed.addFields({ name: '💬 Custom Welcome Message', value: config.welcomeMessage.substring(0, 1024), inline: false });
      }

      if (config.goodbyeMessage) {
        embed.addFields({ name: '💬 Custom Goodbye Message', value: config.goodbyeMessage.substring(0, 1024), inline: false });
      }

      await interaction.reply({ embeds: [embed] });
    }
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
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', ephemeral: true });
      }

      const action = interaction.options.getString('action');
      const channel = interaction.options.getChannel('channel');
      const config = getServerConfig(interaction.guild.id);
      const guildId = interaction.guild.id;

      let embed;

      switch (action) {
        case 'join':
          if (!channel) {
            return interaction.reply({ content: '❌ Please specify a voice channel to join.', ephemeral: true });
          }

          if (!interaction.member.voice.channel) {
            return interaction.reply({ content: '❌ You need to be in a voice channel to use this command.', ephemeral: true });
          }

          const joined = await joinVoice(guildId, channel.id);
          if (joined) {
            embed = new EmbedBuilder()
              .setTitle('✅ Spotify Bot Joined')
              .setColor(0x1DB954)
              .setDescription(`Joined ${channel} and started Spotify playback`)
              .setTimestamp();
          } else {
            embed = new EmbedBuilder()
              .setTitle('❌ Join Failed')
              .setColor(0xFF0000)
              .setDescription('Failed to join the voice channel')
              .setTimestamp();
          }
          break;

        case 'leave':
          const left = leaveVoice(guildId);
          embed = new EmbedBuilder()
            .setTitle(left ? '✅ Spotify Bot Left' : 'ℹ️ Not in Voice Channel')
            .setColor(left ? 0x1DB954 : 0xF39C12)
            .setDescription(left ? 'Left the voice channel' : 'Spotify bot is not in any voice channel')
            .setTimestamp();
          break;

        case 'autojoin':
          config.spotifyAutoJoin = !config.spotifyAutoJoin;
          await saveConfig();
          embed = new EmbedBuilder()
            .setTitle('⚙️ Auto-Join Updated')
            .setColor(0x1DB954)
            .setDescription(`Spotify auto-join has been **${config.spotifyAutoJoin ? 'enabled' : 'disabled'}**`)
            .setTimestamp();
          break;

        case 'setchannel':
          if (!channel) {
            return interaction.reply({ content: '❌ Please specify a voice channel.', ephemeral: true });
          }

          config.spotifyChannel = channel.id;
          await saveConfig();
          embed = new EmbedBuilder()
            .setTitle('✅ Spotify Channel Set')
            .setColor(0x1DB954)
            .setDescription(`Default Spotify channel set to ${channel}`)
            .setTimestamp();
          break;

        case 'status':
          const isConnected = voiceConnections.has(guildId);
          const connection = voiceConnections.get(guildId);
          const currentChannel = connection ? interaction.guild.channels.cache.get(connection.joinConfig.channelId) : null;

          embed = new EmbedBuilder()
            .setTitle('📊 Spotify Bot Status')
            .setColor(0x1DB954)
            .addFields(
              { name: 'Connected', value: isConnected ? '✅ Yes' : '❌ No', inline: true },
              { name: 'Auto-Join', value: config.spotifyAutoJoin ? '✅ Enabled' : '❌ Disabled', inline: true },
              { name: 'Current Channel', value: currentChannel ? currentChannel.toString() : 'None', inline: true },
              { name: 'Default Channel', value: config.spotifyChannel ? `<#${config.spotifyChannel}>` : 'Not set', inline: true }
            )
            .setTimestamp();
          break;
      }

      await interaction.reply({ embeds: [embed] });
    }
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
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.reply({ content: '❌ You need Manage Messages permission.', ephemeral: true });
      }

      const amount = interaction.options.getInteger('amount');

      await interaction.deferReply({ ephemeral: true });

      try {
        const messages = await interaction.channel.bulkDelete(amount, true);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ Messages Cleared')
          .setColor(0x00FF00)
          .setDescription(`Deleted ${messages.size} messages`)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        await interaction.editReply({ content: '❌ Failed to clear messages. Make sure messages are not older than 14 days.' });
      }
    }
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
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.reply({ content: '❌ You need Manage Channels permission.', ephemeral: true });
      }

      const seconds = interaction.options.getInteger('seconds');

      try {
        await interaction.channel.setRateLimitPerUser(seconds);

        const embed = new EmbedBuilder()
          .setTitle('✅ Slowmode Set')
          .setColor(0x00FF00)
          .addFields(
            { name: '⏰ Duration', value: seconds === 0 ? 'Disabled' : `${seconds} seconds`, inline: true },
            { name: '📝 Channel', value: `${interaction.channel}`, inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error setting slowmode:', error);
        await interaction.reply({ content: '❌ Failed to set slowmode.', ephemeral: true });
      }
    }
  }
];

// Register all commands
commands.forEach(cmd => {
  client.commands.set(cmd.name, cmd);
});

// Load configuration when bot starts
loadConfig();

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    message: 'Discord Bot is running!',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    guilds: client?.guilds?.cache?.size || 0,
    memory: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
    platform: process.platform,
    nodeVersion: process.version
  });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    bot: client?.user ? 'connected' : 'disconnected'
  });
});

// Start the health check server
const server = app.listen(PORT, () => {
  console.log(`🫀 Health check server running on port ${PORT}`);
  console.log(`🌐 Health check available at http://localhost:${PORT}`);
});

// Deploy commands function
async function deployCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    
    console.log('🔄 Started refreshing application (/) commands.');

    const commandData = commands.map(command => ({
      name: command.name,
      description: command.description,
      options: command.options || []
    }));

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commandData }
    );

    console.log('✅ Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('❌ Error deploying commands:', error);
  }
}

// Welcome message function
async function sendWelcomeMessages(member) {
  const config = getServerConfig(member.guild.id);

  if (!config.enableWelcome) return;

  const memberCount = member.guild.memberCount;
  console.log(`👋 New member joined: ${member.user.tag} (${member.id})`);

  // DM Welcome Message
  if (config.enableDMs) {
    const dmMessage = `
🎉 **Welcome to ${member.guild.name}, ${member.user}!** 🎉

We're glad to have you here! You are member #${memberCount}.

**Quick Tips:**
• Read the server rules
• Introduce yourself
• Explore different channels and have fun! 🚀

If you need help, don't hesitate to ask our moderators!
    `.trim();

    try {
      await member.send(dmMessage);
      console.log(`✉️ DM sent to ${member.user.tag}`);
    } catch (error) {
      console.error(`❌ Could not send DM to ${member.user.tag}:`, error.message);
    }
  }

  // Channel Welcome Message
  if (config.welcomeChannel) {
    const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannel);

    if (welcomeChannel) {
      let welcomeMessage;

      if (config.welcomeMessage) {
        // Replace placeholders in custom message
        welcomeMessage = config.welcomeMessage
          .replace(/{user}/g, member.user.toString())
          .replace(/{server}/g, member.guild.name)
          .replace(/{count}/g, memberCount)
          .replace(/{username}/g, member.user.username)
          .replace(/{tag}/g, member.user.tag);
      } else {
        // Default welcome message
        welcomeMessage = `🎉 **Welcome to ${member.guild.name}, ${member.user}!** 🎉\n\nWe're excited to have you with us! You are our **#${memberCount}** member!\n\nWelcome to the community! 🚀`;
      }

      try {
        await welcomeChannel.send(welcomeMessage);
        console.log(`📢 Welcome message posted in ${welcomeChannel.name}`);
      } catch (error) {
        console.error(`❌ Could not send message to welcome channel:`, error.message);
      }
    }
  }

  // Auto-role assignment
  if (config.autoRole) {
    try {
      const role = member.guild.roles.cache.get(config.autoRole);
      if (role) {
        await member.roles.add(role);
        console.log(`🔰 Assigned role "${role.name}" to ${member.user.tag}`);
      }
    } catch (error) {
      console.error(`❌ Could not assign auto-role to ${member.user.tag}:`, error.message);
    }
  }
}

// Goodbye message function
async function sendGoodbyeMessage(member) {
  const config = getServerConfig(member.guild.id);

  if (!config.enableGoodbye || !config.goodbyeChannel) return;

  const goodbyeChannel = member.guild.channels.cache.get(config.goodbyeChannel);

  if (!goodbyeChannel) return;

  let goodbyeMessage;

  if (config.goodbyeMessage) {
    // Replace placeholders in custom message
    goodbyeMessage = config.goodbyeMessage
      .replace(/{user}/g, member.user.tag)
      .replace(/{server}/g, member.guild.name)
      .replace(/{username}/g, member.user.username)
      .replace(/{count}/g, member.guild.memberCount);
  } else {
    // Default goodbye message
    goodbyeMessage = `👋 **Goodbye, ${member.user.tag}!**\n\nWe're sad to see you leave ${member.guild.name}. You'll be missed! 😢\n\n**Server Members:** ${member.guild.memberCount}`;
  }

  try {
    await goodbyeChannel.send(goodbyeMessage);
    console.log(`📢 Goodbye message posted for ${member.user.tag}`);
  } catch (error) {
    console.error(`❌ Could not send goodbye message:`, error.message);
  }
}

// Auto-join voice channel when you join
client.on('voiceStateUpdate', async (oldState, newState) => {
  // Check if it's you who joined a voice channel
  const yourUserId = process.env.YOUR_USER_ID || 'YOUR_USER_ID_HERE';

  if (newState.member.id === yourUserId) {
    const config = getServerConfig(newState.guild.id);

    // Check if auto-join is enabled and we're not already in a voice channel
    if (config.spotifyAutoJoin && !voiceConnections.has(newState.guild.id)) {
      const channelToJoin = config.spotifyChannel || newState.channelId;

      if (channelToJoin) {
        console.log(`🔊 Auto-joining voice channel for ${newState.member.user.tag}`);
        await joinVoice(newState.guild.id, channelToJoin);
      }
    }
  }

  // Auto-leave if everyone leaves the voice channel
  if (oldState.channel && !newState.channel) {
    const connection = voiceConnections.get(oldState.guild.id);
    if (connection) {
      const voiceChannel = oldState.guild.channels.cache.get(connection.joinConfig.channelId);
      if (voiceChannel && voiceChannel.members.size === 1) {
        setTimeout(() => {
          if (voiceChannel.members.size === 1) {
            leaveVoice(oldState.guild.id);
            console.log(`🔊 Auto-left empty voice channel in ${oldState.guild.name}`);
          }
        }, 30000);
      }
    }
  }
});

// Event Handlers
client.once('ready', async (c) => {
  console.log(`✅ Bot is ready! Logged in as ${c.user.tag}`);
  console.log(`📊 Serving ${c.guilds.cache.size} server(s)`);
  console.log(`🔄 Loaded ${client.commands.size} commands`);
  console.log(`🌐 Health check server running on port ${PORT}`);

  // Deploy commands when bot starts
  await deployCommands();

  // Set bot activity
  client.user.setActivity({
    name: `${c.guilds.cache.size} servers | /help`,
    type: ActivityType.Watching
  });
});

client.on('guildMemberAdd', async (member) => {
  await sendWelcomeMessages(member);
});

client.on('guildMemberRemove', async (member) => {
  console.log(`👋 Member left: ${member.user.tag} (${member.id})`);
  await sendGoodbyeMessage(member);
});

// Interaction handler for slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing command ${interaction.commandName}:`, error);
    await interaction.reply({ 
      content: '❌ There was an error executing this command!', 
      ephemeral: true 
    });
  }
});

// Message-based commands (fallback)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Basic ping command
  if (message.content === '!ping') {
    const sent = await message.reply('Pinging... 🏓');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const apiLatency = Math.round(client.ws.ping);

    await sent.edit(`🏓 Pong!\n• Bot Latency: ${latency}ms\n• API Latency: ${apiLatency}ms`);
  }

  // Help command
  if (message.content === '!help') {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Bot Commands')
      .setColor(0x3498DB)
      .setDescription(`**Slash Commands:**\nUse \`/\` followed by the command name\n\n**Message Commands:**`)
      .addFields(
        { name: '🎪 General', value: '`!ping`, `!help`', inline: true },
        { name: '📊 Info', value: 'Use `/server-info`, `/user-info`', inline: true }
      )
      .setFooter({ text: 'Slash commands recommended for full features!' });

    await message.reply({ embeds: [embed] });
  }
});

// Error handling
client.on('error', (error) => {
  console.error('❌ Discord client error:', error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔄 Shutting down bot gracefully...');
  voiceConnections.forEach((connection, guildId) => {
    leaveVoice(guildId);
  });
  server.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🔄 Shutting down bot gracefully...');
  voiceConnections.forEach((connection, guildId) => {
    leaveVoice(guildId);
  });
  server.close();
  client.destroy();
  process.exit(0);
});

// Debug: Check environment variables
console.log('🔧 Environment Check:');
console.log('PORT:', process.env.PORT);
console.log('DISCORD_BOT_TOKEN exists:', !!process.env.DISCORD_BOT_TOKEN);
console.log('CLIENT_ID exists:', !!process.env.CLIENT_ID);
console.log('YOUR_USER_ID exists:', !!process.env.YOUR_USER_ID);

// Get token from environment variables
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('❌ ERROR: DISCORD_BOT_TOKEN is not set!');
  console.log('💡 Make sure you have a .env file with your bot token');
  console.log('💡 Check that the .env file is in the same folder as index.js');
  console.log('💡 Verify the .env file has DISCORD_BOT_TOKEN=your_token_here');
  process.exit(1);
}

// Login to Discord
console.log('🔐 Attempting to login to Discord...');
client.login(token).catch(error => {
  console.error('❌ Failed to login:', error.message);
  console.log('💡 Check if your bot token is correct');
  console.log('💡 Make sure you invited the bot to your server');
  process.exit(1);
});