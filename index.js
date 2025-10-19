// Load environment variables FIRST
require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Collection, PermissionsBitField, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, VoiceConnectionStatus, StreamType, NoSubscriberBehavior } = require('@discordjs/voice');
const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const ytdl = require('ytdl-core');
const quickdb = require('quick.db');

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
  ]
});

// Keep-alive interval
const KEEP_ALIVE_INTERVAL = 4 * 60 * 1000;
setInterval(() => {
  if (client?.user) {
    console.log(`💓 Keep-alive | Uptime: ${Math.floor(process.uptime() / 60)}m | Guilds: ${client.guilds.cache.size}`);
  }
}, KEEP_ALIVE_INTERVAL);

// Command handler
client.commands = new Collection();

// Configuration storage
const configPath = path.join(__dirname, 'config.json');
let serverConfigs = {};

// Voice connection storage
const voiceConnections = new Map();
const audioPlayers = new Map();
const musicQueues = new Map();

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
      music: {
        enabled: true,
        textChannel: null,
        defaultVolume: 50
      }
    };
  }
  return serverConfigs[guildId];
}

// Enhanced Music System
class MusicSystem {
  static getQueue(guildId) {
    if (!musicQueues.has(guildId)) {
      musicQueues.set(guildId, {
        songs: [],
        isPlaying: false,
        volume: 0.5,
        loop: false,
        nowPlaying: null
      });
    }
    return musicQueues.get(guildId);
  }

  static async playSong(guildId) {
    const queue = this.getQueue(guildId);
    if (queue.songs.length === 0) {
      queue.isPlaying = false;
      queue.nowPlaying = null;
      return;
    }

    const connection = voiceConnections.get(guildId);
    const player = audioPlayers.get(guildId);

    if (!connection || !player) {
      queue.isPlaying = false;
      queue.nowPlaying = null;
      return;
    }

    try {
      const song = queue.songs[0];
      
      if (!ytdl.validateURL(song.url)) {
        throw new Error('Invalid YouTube URL');
      }

      const stream = ytdl(song.url, {
        filter: 'audioonly',
        quality: 'lowestaudio',
        highWaterMark: 1 << 25
      });

      const resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });

      resource.volume.setVolume(queue.volume);
      player.play(resource);
      queue.nowPlaying = song;
      queue.isPlaying = true;

    } catch (error) {
      console.error('Error playing song:', error);
      queue.songs.shift();
      if (queue.songs.length > 0) {
        setTimeout(() => this.playSong(guildId), 2000);
      } else {
        queue.isPlaying = false;
        queue.nowPlaying = null;
      }
    }
  }

  static async addToQueue(guildId, song) {
    const queue = this.getQueue(guildId);
    
    if (ytdl.validateURL(song.url)) {
      try {
        const info = await ytdl.getInfo(song.url);
        song.title = info.videoDetails.title;
        song.duration = info.videoDetails.lengthSeconds;
        song.thumbnail = info.videoDetails.thumbnails[0]?.url;
      } catch (error) {
        song.title = 'Unknown Title';
        song.duration = 0;
      }
    }
    
    queue.songs.push(song);
    const position = queue.songs.length;

    if (!queue.isPlaying) {
      this.playSong(guildId);
    }

    return position;
  }

  static skipSong(guildId) {
    const queue = this.getQueue(guildId);
    const player = audioPlayers.get(guildId);
    
    if (player && queue.isPlaying) {
      player.stop();
      return true;
    }
    return false;
  }

  static stopMusic(guildId) {
    const queue = this.getQueue(guildId);
    const player = audioPlayers.get(guildId);
    
    queue.songs = [];
    queue.isPlaying = false;
    queue.nowPlaying = null;
    
    if (player) {
      player.stop();
    }
    
    return true;
  }

  static setVolume(guildId, volume) {
    const queue = this.getQueue(guildId);
    queue.volume = Math.max(0.1, Math.min(1, volume / 100));
    return queue.volume;
  }

  static getNowPlaying(guildId) {
    const queue = this.getQueue(guildId);
    return queue.nowPlaying;
  }

  static getQueueList(guildId) {
    const queue = this.getQueue(guildId);
    return queue.songs;
  }
}

// Enhanced Voice Connection
async function joinVoice(guildId, channelId) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return null;

    // Leave existing connection if any
    if (voiceConnections.has(guildId)) {
      leaveVoice(guildId);
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });
    
    audioPlayers.set(guildId, player);

    connection.on(VoiceConnectionStatus.Ready, () => {
      console.log(`🔊 Joined voice channel: ${channel.name} in ${guild.name}`);
      connection.subscribe(player);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch (error) {
        console.log(`🔊 Disconnected from voice channel in ${guild.name}`);
        connection.destroy();
        voiceConnections.delete(guildId);
        audioPlayers.delete(guildId);
        musicQueues.delete(guildId);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      console.log(`🔊 Connection destroyed in ${guild.name}`);
      voiceConnections.delete(guildId);
      audioPlayers.delete(guildId);
      musicQueues.delete(guildId);
    });

    // Enhanced audio player event handling
    player.on(AudioPlayerStatus.Idle, () => {
      const queue = MusicSystem.getQueue(guildId);
      if (queue.songs.length > 0) {
        queue.songs.shift();
        setTimeout(() => MusicSystem.playSong(guildId), 1000);
      } else {
        queue.isPlaying = false;
        queue.nowPlaying = null;
      }
    });

    player.on('error', error => {
      console.error('🔊 Audio player error:', error);
      const queue = MusicSystem.getQueue(guildId);
      queue.songs.shift();
      if (queue.songs.length > 0) {
        setTimeout(() => MusicSystem.playSong(guildId), 2000);
      } else {
        queue.isPlaying = false;
        queue.nowPlaying = null;
      }
    });

    voiceConnections.set(guildId, connection);
    return connection;

  } catch (error) {
    console.error('❌ Error joining voice channel:', error);
    return null;
  }
}

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
    musicQueues.delete(guildId);
    console.log(`🔊 Left voice channel in guild ${guildId}`);
    return true;
  }

  return false;
}

// Command Definitions
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
      // Check if we need to defer or can reply immediately
      let deferred = false;
      
      // For commands that might take time, defer first
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
        deferred = true;
      }

      const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Help Menu')
        .setColor(0x3498DB)
        .setDescription('Here are all available commands!')
        .addFields(
          { name: '🎪 General', value: '`/ping`, `/help`', inline: false },
          { name: '🎵 Music', value: '`/join`, `/leave`, `/play`, `/skip`, `/stop`, `/queue`, `/volume`, `/nowplaying`', inline: false },
          { name: '⚙️ Admin', value: '`/setwelcome`, `/setgoodbye`, `/config`', inline: false }
        )
        .setFooter({ text: 'Use slash commands (/) to interact with the bot!' });

      try {
        if (deferred) {
          await interaction.editReply({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed] });
        }
      } catch (error) {
        console.error('Error sending help response:', error);
      }
    }
  },,
  {
    name: 'join',
    description: 'Join a specific voice channel',
    options: [
      {
        name: 'channel',
        type: 7,
        description: 'The voice channel to join',
        required: true,
        channel_types: [2]
      }
    ],
    async execute(interaction) {
      const channel = interaction.options.getChannel('channel');
      
      if (channel.type !== 2) {
        return interaction.reply({ content: '❌ Please select a voice channel!', ephemeral: true });
      }

      try {
        const joined = await joinVoice(interaction.guild.id, channel.id);
        if (joined) {
          await interaction.reply(`✅ Joined ${channel}`);
        } else {
          await interaction.reply('❌ Failed to join voice channel!');
        }
      } catch (error) {
        console.error('Error joining voice:', error);
        await interaction.reply('❌ Failed to join voice channel!');
      }
    }
  },
  {
    name: 'leave',
    description: 'Leave the voice channel',
    async execute(interaction) {
      const left = leaveVoice(interaction.guild.id);
      if (left) {
        await interaction.reply('✅ Left the voice channel!');
      } else {
        await interaction.reply('❌ Not in a voice channel!');
      }
    }
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
    ],
    async execute(interaction) {
      await interaction.deferReply();
      
      const url = interaction.options.getString('url');
      const voiceChannel = interaction.member.voice.channel;
      
      if (!voiceChannel) {
        return interaction.editReply('❌ You need to be in a voice channel to play music!');
      }

      // Validate YouTube URL
      if (!ytdl.validateURL(url)) {
        return interaction.editReply('❌ Please provide a valid YouTube URL!');
      }

      try {
        // Get video info first
        const info = await ytdl.getInfo(url);
        const song = {
          url: url,
          title: info.videoDetails.title,
          duration: info.videoDetails.lengthSeconds,
          thumbnail: info.videoDetails.thumbnails[0]?.url,
          requestedBy: interaction.user.tag
        };

        // Join voice channel if not connected
        if (!voiceConnections.has(interaction.guild.id)) {
          const joined = await joinVoice(interaction.guild.id, voiceChannel.id);
          if (!joined) {
            return interaction.editReply('❌ Failed to join voice channel!');
          }
          // Small delay to ensure connection is ready
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const position = await MusicSystem.addToQueue(interaction.guild.id, song);
        
        const duration = song.duration ? 
          `${Math.floor(song.duration / 60)}:${(song.duration % 60).toString().padStart(2, '0')}` : 
          'Unknown';
        
        const embed = new EmbedBuilder()
          .setTitle('🎵 Added to Queue')
          .setColor(0x1DB954)
          .setDescription(`**[${song.title}](${url})**`)
          .addFields(
            { name: 'Duration', value: duration, inline: true },
            { name: 'Requested By', value: interaction.user.tag, inline: true },
            { name: 'Position in Queue', value: `#${position}`, inline: true }
          )
          .setThumbnail(song.thumbnail)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error in play command:', error);
        await interaction.editReply('❌ Failed to play the song. Please try a different URL.');
      }
    }
  },
  {
    name: 'skip',
    description: 'Skip the current song',
    async execute(interaction) {
      const skipped = MusicSystem.skipSong(interaction.guild.id);
      
      if (skipped) {
        await interaction.reply('⏭️ Skipped the current song!');
      } else {
        await interaction.reply('❌ No song is currently playing.');
      }
    }
  },
  {
    name: 'stop',
    description: 'Stop the music and clear the queue',
    async execute(interaction) {
      const stopped = MusicSystem.stopMusic(interaction.guild.id);
      
      if (stopped) {
        await interaction.reply('⏹️ Stopped the music and cleared the queue!');
      } else {
        await interaction.reply('❌ No music is currently playing.');
      }
    }
  },
  {
    name: 'queue',
    description: 'Show the current music queue',
    async execute(interaction) {
      const queue = MusicSystem.getQueueList(interaction.guild.id);
      
      if (queue.length === 0) {
        return interaction.reply('📭 The queue is empty!');
      }

      const nowPlaying = MusicSystem.getNowPlaying(interaction.guild.id);
      const queueList = queue.slice(0, 10).map((song, index) => 
        `**${index + 1}.** ${song.title} - ${song.requestedBy}`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('🎵 Music Queue')
        .setColor(0x1DB954)
        .setDescription(nowPlaying ? `**Now Playing:** ${nowPlaying.title}\n\n**Up Next:**\n${queueList}` : `**Queue:**\n${queueList}`)
        .setFooter({ text: `Total songs in queue: ${queue.length}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'nowplaying',
    description: 'Show the currently playing song',
    async execute(interaction) {
      const nowPlaying = MusicSystem.getNowPlaying(interaction.guild.id);
      
      if (!nowPlaying) {
        return interaction.reply('❌ No song is currently playing!');
      }

      const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing')
        .setColor(0x1DB954)
        .setDescription(`**${nowPlaying.title}**`)
        .addFields(
          { name: 'Requested By', value: nowPlaying.requestedBy, inline: true },
          { name: 'URL', value: `[Click Here](${nowPlaying.url})`, inline: true }
        )
        .setThumbnail(nowPlaying.thumbnail)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
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
    ],
    async execute(interaction) {
      const volume = interaction.options.getInteger('volume');
      const newVolume = MusicSystem.setVolume(interaction.guild.id, volume);
      
      await interaction.reply(`🔊 Volume set to ${Math.round(newVolume * 100)}%`);
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
      const message = interaction.options.getString('message');

      const config = getServerConfig(interaction.guild.id);
      config.welcomeChannel = channel.id;
      if (message) config.welcomeMessage = message;

      await saveConfig();

      const embed = new EmbedBuilder()
        .setTitle('✅ Welcome Channel Set')
        .setColor(0x00FF00)
        .setDescription(`Welcome messages will be sent to ${channel}`)
        .addFields(
          { name: 'Channel', value: `${channel}`, inline: true },
          { name: 'Custom Message', value: message ? '✅ Set' : '❌ Not set', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
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
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');

      const config = getServerConfig(interaction.guild.id);
      config.goodbyeChannel = channel.id;
      if (message) config.goodbyeMessage = message;

      await saveConfig();

      const embed = new EmbedBuilder()
        .setTitle('✅ Goodbye Channel Set')
        .setColor(0x00FF00)
        .setDescription(`Goodbye messages will be sent to ${channel}`)
        .addFields(
          { name: 'Channel', value: `${channel}`, inline: true },
          { name: 'Custom Message', value: message ? '✅ Set' : '❌ Not set', inline: true }
        )
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

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Server Configuration')
        .setColor(0x3498DB)
        .addFields(
          { name: 'Welcome Channel', value: config.welcomeChannel ? `<#${config.welcomeChannel}>` : '❌ Not set', inline: true },
          { name: 'Goodbye Channel', value: config.goodbyeChannel ? `<#${config.goodbyeChannel}>` : '❌ Not set', inline: true },
          { name: 'Auto Role', value: config.autoRole ? `<@&${config.autoRole}>` : '❌ Not set', inline: true },
          { name: 'Welcome Messages', value: config.enableWelcome ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: 'Goodbye Messages', value: config.enableGoodbye ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: 'Welcome DMs', value: config.enableDMs ? '✅ Enabled' : '❌ Disabled', inline: true }
        )
        .setFooter({ text: 'Use /setwelcome and /setgoodbye to configure' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  }
];

// Register all commands
commands.forEach(cmd => {
  client.commands.set(cmd.name, cmd);
});

// Load configuration when bot starts
loadConfig();

// Quick health check endpoint that responds immediately
app.get('/quick-health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    bot: client?.user ? 'ready' : 'starting'
  });
});

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

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    bot: client?.user ? 'connected' : 'disconnected',
    guilds: client?.guilds?.cache?.size || 0,
    uptime: Math.floor(process.uptime())
  });
});

const server = app.listen(PORT, () => {
  console.log(`🫀 Health check server running on port ${PORT}`);
  console.log(`🌐 Health check available at http://localhost:${PORT}`);
});

// Deploy commands function - OPTIMIZED VERSION
async function deployCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    
    console.log('🔄 Started refreshing application (/) commands.');

    // Only include commands that have execute functions
    const deployableCommands = commands.filter(cmd => cmd.execute);
    
    const commandData = deployableCommands.map(command => ({
      name: command.name,
      description: command.description,
      options: command.options || []
    }));

    console.log(`📝 Deploying ${commandData.length} commands...`);

    const data = await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commandData }
    );

    console.log(`✅ Successfully reloaded ${data.length} application (/) commands.`);
    return true;
    
  } catch (error) {
    console.error('❌ Error deploying commands:', error);
    
    // Don't throw error - just log it and continue
    if (error.code === 50001) {
      console.log('💡 Missing Access: Make sure your bot has "applications.commands" scope');
    } else if (error.code === 50013) {
      console.log('💡 Missing Permissions: Bot needs "Use Application Commands" permission');
    }
    
    return false;
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

**Features:**
• Music System - Play songs in voice channels
• Welcome Messages - Personalized greetings
• Easy to use commands

**Quick Start:**
• Use /join to make the bot join a voice channel
• Use /play to play music from YouTube
• Use /help to see all commands

Enjoy your stay! 🚀
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
        welcomeMessage = config.welcomeMessage
          .replace(/{user}/g, member.user.toString())
          .replace(/{server}/g, member.guild.name)
          .replace(/{count}/g, memberCount)
          .replace(/{username}/g, member.user.username)
          .replace(/{tag}/g, member.user.tag);
      } else {
        welcomeMessage = `🎉 **Welcome to ${member.guild.name}, ${member.user}!** 🎉\n\nWe're excited to have you with us! You are our **#${memberCount}** member!\n\nUse \`/help\` to see all available commands and \`/join\` to start playing music! 🎵`;
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
    goodbyeMessage = config.goodbyeMessage
      .replace(/{user}/g, member.user.tag)
      .replace(/{server}/g, member.guild.name)
      .replace(/{username}/g, member.user.username)
      .replace(/{count}/g, member.guild.memberCount);
  } else {
    goodbyeMessage = `👋 **Goodbye, ${member.user.tag}!**\n\nWe're sad to see you leave ${member.guild.name}. You'll be missed! 😢\n\n**Server Members:** ${member.guild.memberCount}`;
  }

  try {
    await goodbyeChannel.send(goodbyeMessage);
    console.log(`📢 Goodbye message posted for ${member.user.tag}`);
  } catch (error) {
    console.error(`❌ Could not send goodbye message:`, error.message);
  }
}

// Auto-leave if everyone leaves the voice channel
client.on('voiceStateUpdate', async (oldState, newState) => {
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

  // Set activity immediately - don't wait for command deployment
  client.user.setActivity({
    name: `${c.guilds.cache.size} servers | /help`,
    type: ActivityType.Watching
  });

  // Auto-deploy commands on startup (only in production) - BUT DON'T AWAIT IT
  if (process.env.NODE_ENV === 'production') {
    console.log('🚀 Starting async command deployment...');
    
    // Deploy commands in background without blocking
    deployCommands().then(() => {
      console.log('✅ Commands deployed successfully');
    }).catch(error => {
      console.error('❌ Command deployment failed:', error.message);
      // Bot continues running even if deployment fails
    });
  }
});

client.on('guildMemberAdd', async (member) => {
  await sendWelcomeMessages(member);
});

client.on('guildMemberRemove', async (member) => {
  console.log(`👋 Member left: ${member.user.tag} (${member.id})`);
  await sendGoodbyeMessage(member);
});

// Unified interaction handler — faster and safer
// Unified interaction handler — fixed version
client.on('interactionCreate', async (interaction) => {
  try {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      console.log(`🔧 Executing command: /${interaction.commandName} by ${interaction.user.tag}`);

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`❌ Command error in /${interaction.commandName}:`, error);
        
        // Safe error response
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ 
              content: '❌ Something went wrong while executing that command.',
              embeds: [],
              components: []
            });
          } else {
            await interaction.reply({ 
              content: '❌ Something went wrong while executing that command.',
              flags: 64 
            });
          }
        } catch (responseError) {
          console.error('❌ Failed to send error response:', responseError);
        }
      }
      return;
    }
  } catch (error) {
    console.error('❌ Interaction handler error:', error);
  }
});

// Basic message commands
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
        { name: '🎪 General', value: '`!ping`, `!help`', inline: true }
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