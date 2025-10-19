// Load environment variables FIRST
require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Collection, PermissionsBitField, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
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
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
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

// Auto-moderation storage
const autoModEnabled = new Map();
const bannedWords = new Map();
const userWarnings = new Map();

// Rules system storage
const serverRules = new Map();

// Load configuration
async function loadConfig() {
  try {
    const data = await fs.readFile(configPath, 'utf8');
    const savedData = JSON.parse(data);
    serverConfigs = savedData.serverConfigs || {};
    
    // Load auto-mod data
    if (savedData.autoModEnabled) {
      Object.keys(savedData.autoModEnabled).forEach(guildId => {
        autoModEnabled.set(guildId, savedData.autoModEnabled[guildId]);
      });
    }
    
    if (savedData.bannedWords) {
      Object.keys(savedData.bannedWords).forEach(guildId => {
        bannedWords.set(guildId, savedData.bannedWords[guildId]);
      });
    }
    
    if (savedData.userWarnings) {
      Object.keys(savedData.userWarnings).forEach(guildId => {
        userWarnings.set(guildId, savedData.userWarnings[guildId]);
      });
    }
    
    if (savedData.serverRules) {
      Object.keys(savedData.serverRules).forEach(guildId => {
        serverRules.set(guildId, savedData.serverRules[guildId]);
      });
    }
    
    console.log('✅ Configuration loaded successfully');
  } catch (error) {
    console.log('⚠️ No existing configuration found, starting fresh');
    serverConfigs = {};
  }
}

// Save configuration
async function saveConfig() {
  try {
    const dataToSave = {
      serverConfigs,
      autoModEnabled: Object.fromEntries(autoModEnabled),
      bannedWords: Object.fromEntries(bannedWords),
      userWarnings: Object.fromEntries(userWarnings),
      serverRules: Object.fromEntries(serverRules)
    };
    
    await fs.writeFile(configPath, JSON.stringify(dataToSave, null, 2));
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
      },
      logChannel: null,
      verificationChannel: null,
      verificationRole: null
    };
  }
  return serverConfigs[guildId];
}

// YouTube URL validation function
function validateYouTubeUrl(url) {
  // Basic YouTube URL patterns
  const patterns = [
    /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /^(https?:\/\/)?(www\.)?(youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /^(https?:\/\/)?(www\.)?(youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^(https?:\/\/)?(www\.)?(youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^(https?:\/\/)?(www\.)?(youtube\.com\/attribution_link\?.*v=)([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        isValid: true,
        videoId: match[4],
        normalizedUrl: `https://www.youtube.com/watch?v=${match[4]}`
      };
    }
  }

  return { isValid: false };
}

// Enhanced Music System with Better Error Handling
class MusicSystem {
  static getQueue(guildId) {
    if (!musicQueues.has(guildId)) {
      musicQueues.set(guildId, {
        songs: [],
        isPlaying: false,
        volume: 0.5,
        loop: false,
        nowPlaying: null,
        connection: null
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
      
      // Validate URL
      if (!ytdl.validateURL(song.url)) {
        throw new Error('Invalid YouTube URL');
      }

      console.log(`🎵 Attempting to play: ${song.title}`);

      // Use ytdl with better error handling and options (NO COOKIES NEEDED)
      const stream = ytdl(song.url, {
        filter: 'audioonly',
        quality: 'lowestaudio',
        highWaterMark: 1 << 25,
        dlChunkSize: 0
        // Removed cookie requirement - works for public videos
      });

      stream.on('error', (error) => {
        console.error('Stream error:', error);
        this.handlePlayError(guildId, error);
      });

      const resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });

      resource.volume.setVolume(queue.volume);
      player.play(resource);
      queue.nowPlaying = song;
      queue.isPlaying = true;

      console.log(`🎵 Now playing: ${song.title}`);

    } catch (error) {
      console.error('Error in playSong:', error);
      this.handlePlayError(guildId, error);
    }
  }

  static handlePlayError(guildId, error) {
    const queue = this.getQueue(guildId);
    console.error('Playback error:', error);
    
    // Remove the problematic song
    if (queue.songs.length > 0) {
      queue.songs.shift();
    }
    
    // Try next song if available
    if (queue.songs.length > 0) {
      setTimeout(() => this.playSong(guildId), 2000);
    } else {
      queue.isPlaying = false;
      queue.nowPlaying = null;
    }
  }

  static async addToQueue(guildId, song) {
    const queue = this.getQueue(guildId);
    
    if (ytdl.validateURL(song.url)) {
      try {
        const info = await ytdl.getInfo(song.url);
        song.title = info.videoDetails.title;
        song.duration = parseInt(info.videoDetails.lengthSeconds);
        song.thumbnail = info.videoDetails.thumbnails[0]?.url;
        song.durationFormatted = this.formatDuration(song.duration);
      } catch (error) {
        console.error('Error getting video info:', error);
        song.title = 'Unknown Title';
        song.duration = 0;
        song.durationFormatted = 'Unknown';
      }
    } else {
      song.title = 'Unknown Title';
      song.duration = 0;
      song.durationFormatted = 'Unknown';
    }
    
    queue.songs.push(song);
    const position = queue.songs.length;

    if (!queue.isPlaying) {
      setTimeout(() => this.playSong(guildId), 1000);
    }

    return position;
  }

  static formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return 'Unknown';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
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

  static shuffleQueue(guildId) {
    const queue = this.getQueue(guildId);
    if (queue.songs.length > 0) {
      const current = queue.songs.shift(); // Remove current playing
      for (let i = queue.songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
      }
      if (current) queue.songs.unshift(current); // Put current back
      return true;
    }
    return false;
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
        const finishedSong = queue.songs.shift();
        console.log(`🎵 Finished playing: ${finishedSong?.title}`);
        
        if (queue.songs.length > 0) {
          setTimeout(() => MusicSystem.playSong(guildId), 1000);
        } else {
          queue.isPlaying = false;
          queue.nowPlaying = null;
          console.log('🎵 Queue finished');
        }
      } else {
        queue.isPlaying = false;
        queue.nowPlaying = null;
      }
    });

    player.on('error', error => {
      console.error('🔊 Audio player error:', error);
      const queue = MusicSystem.getQueue(guildId);
      if (queue.songs.length > 0) {
        queue.songs.shift(); // Remove problematic song
        if (queue.songs.length > 0) {
          setTimeout(() => MusicSystem.playSong(guildId), 2000);
        }
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

// Auto-Moderation System
class AutoModSystem {
  static isEnabled(guildId) {
    return autoModEnabled.get(guildId) || false;
  }

  static toggle(guildId) {
    const current = this.isEnabled(guildId);
    autoModEnabled.set(guildId, !current);
    saveConfig();
    return !current;
  }

  static getBannedWords(guildId) {
    if (!bannedWords.has(guildId)) {
      bannedWords.set(guildId, []);
    }
    return bannedWords.get(guildId);
  }

  static addBannedWord(guildId, word) {
    const words = this.getBannedWords(guildId);
    if (!words.includes(word.toLowerCase())) {
      words.push(word.toLowerCase());
      saveConfig();
      return true;
    }
    return false;
  }

  static removeBannedWord(guildId, word) {
    const words = this.getBannedWords(guildId);
    const index = words.indexOf(word.toLowerCase());
    if (index > -1) {
      words.splice(index, 1);
      saveConfig();
      return true;
    }
    return false;
  }

  static checkMessage(content, guildId) {
    if (!this.isEnabled(guildId)) return null;
    
    const words = this.getBannedWords(guildId);
    const lowerContent = content.toLowerCase();
    
    for (const word of words) {
      if (lowerContent.includes(word)) {
        return word;
      }
    }
    return null;
  }

  static async handleViolation(message, bannedWord) {
    try {
      // Delete the message
      await message.delete();
      
      // Add warning to user
      this.addWarning(message.guild.id, message.author.id, `Used banned word: ${bannedWord}`);
      
      // Send warning to user
      try {
        const warningDM = new EmbedBuilder()
          .setTitle('⚠️ Auto-Moderation Warning')
          .setColor(0xFFA500)
          .setDescription(`Your message in **${message.guild.name}** was deleted for containing a banned word.`)
          .addFields(
            { name: 'Banned Word', value: bannedWord, inline: true },
            { name: 'Message', value: message.content.slice(0, 100) + '...', inline: true }
          )
          .setFooter({ text: 'Repeated violations may result in mutes or bans' })
          .setTimestamp();

        await message.author.send({ embeds: [warningDM] });
      } catch (dmError) {
        console.log(`Could not send DM to ${message.author.tag}`);
      }

      // Log the action
      const config = getServerConfig(message.guild.id);
      if (config.logChannel) {
        const logChannel = message.guild.channels.cache.get(config.logChannel);
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle('🔨 Auto-Mod Action')
            .setColor(0xFF0000)
            .setDescription(`Message deleted for banned word`)
            .addFields(
              { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
              { name: 'Channel', value: `${message.channel}`, inline: true },
              { name: 'Banned Word', value: bannedWord, inline: true },
              { name: 'Message', value: message.content.slice(0, 200) + '...', inline: false }
            )
            .setTimestamp();

          await logChannel.send({ embeds: [logEmbed] });
        }
      }

    } catch (error) {
      console.error('Error handling auto-mod violation:', error);
    }
  }

  static addWarning(guildId, userId, reason) {
    const guildWarnings = userWarnings.get(guildId) || {};
    if (!guildWarnings[userId]) {
      guildWarnings[userId] = [];
    }
    guildWarnings[userId].push({
      reason,
      timestamp: Date.now(),
      moderator: 'Auto-Mod'
    });
    userWarnings.set(guildId, guildWarnings);
    saveConfig();
    
    // Check if user should be muted (3+ warnings)
    const userWarningCount = guildWarnings[userId].length;
    if (userWarningCount >= 3) {
      this.autoMuteUser(guildId, userId);
    }
    
    return userWarningCount;
  }

  static async autoMuteUser(guildId, userId) {
    try {
      const guild = client.guilds.cache.get(guildId);
      const member = await guild.members.fetch(userId);
      
      // You would need to create a muted role first
      // This is a placeholder for mute functionality
      console.log(`🔇 Auto-mute triggered for ${member.user.tag} in ${guild.name}`);
      
    } catch (error) {
      console.error('Error auto-muting user:', error);
    }
  }

  static getWarnings(guildId, userId) {
    const guildWarnings = userWarnings.get(guildId) || {};
    return guildWarnings[userId] || [];
  }

  static clearWarnings(guildId, userId) {
    const guildWarnings = userWarnings.get(guildId) || {};
    if (guildWarnings[userId]) {
      delete guildWarnings[userId];
      userWarnings.set(guildId, guildWarnings);
      saveConfig();
      return true;
    }
    return false;
  }
}

// Rules System
class RulesSystem {
  static getRules(guildId) {
    if (!serverRules.has(guildId)) {
      serverRules.set(guildId, []);
    }
    return serverRules.get(guildId);
  }

  static addRule(guildId, rule) {
    const rules = this.getRules(guildId);
    rules.push(rule);
    saveConfig();
    return rules.length;
  }

  static removeRule(guildId, index) {
    const rules = this.getRules(guildId);
    if (index >= 1 && index <= rules.length) {
      rules.splice(index - 1, 1);
      saveConfig();
      return true;
    }
    return false;
  }

  static clearRules(guildId) {
    serverRules.set(guildId, []);
    saveConfig();
    return true;
  }

  static async postRules(guildId, channel) {
    const rules = this.getRules(guildId);
    if (rules.length === 0) {
      return false;
    }

    const rulesEmbed = new EmbedBuilder()
      .setTitle('📜 Server Rules')
      .setColor(0x0099FF)
      .setDescription('Please read and follow these rules:')
      .setTimestamp();

    rules.forEach((rule, index) => {
      rulesEmbed.addFields({
        name: `Rule ${index + 1}`,
        value: rule,
        inline: false
      });
    });

    rulesEmbed.addFields({
      name: 'Agreement',
      value: 'By remaining in this server, you agree to follow these rules.',
      inline: false
    });

    await channel.send({ embeds: [rulesEmbed] });
    return true;
  }
}

// Verification System
class VerificationSystem {
  static async setupVerification(guildId, channelId, roleId) {
    const config = getServerConfig(guildId);
    config.verificationChannel = channelId;
    config.verificationRole = roleId;
    await saveConfig();

    try {
      const guild = client.guilds.cache.get(guildId);
      const channel = guild.channels.cache.get(channelId);
      const role = guild.roles.cache.get(roleId);

      if (!channel || !role) {
        return false;
      }

      const verifyEmbed = new EmbedBuilder()
        .setTitle('✅ Verification Required')
        .setColor(0x00FF00)
        .setDescription('Click the button below to verify yourself and gain access to the server!')
        .addFields(
          { name: 'How to verify', value: 'Simply click the "Verify" button below and you will receive the verified role.', inline: false },
          { name: 'Need help?', value: 'Contact server staff if you have any issues.', inline: false }
        )
        .setFooter({ text: 'Verification System' })
        .setTimestamp();

      const verifyButton = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('verify_user')
            .setLabel('Verify Me')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅')
        );

      await channel.send({
        embeds: [verifyEmbed],
        components: [verifyButton]
      });

      return true;
    } catch (error) {
      console.error('Error setting up verification:', error);
      return false;
    }
  }

  static async handleVerification(interaction) {
    try {
      const config = getServerConfig(interaction.guild.id);
      if (!config.verificationRole) {
        return await interaction.reply({
          content: '❌ Verification system is not properly configured.',
          flags: 64
        });
      }

      const role = interaction.guild.roles.cache.get(config.verificationRole);
      if (!role) {
        return await interaction.reply({
          content: '❌ Verification role not found.',
          flags: 64
        });
      }

      await interaction.member.roles.add(role);
      
      await interaction.reply({
        content: '✅ You have been successfully verified! Welcome to the server!',
        flags: 64
      });

      console.log(`✅ Verified user: ${interaction.user.tag} in ${interaction.guild.name}`);

    } catch (error) {
      console.error('Error handling verification:', error);
      await interaction.reply({
        content: '❌ An error occurred during verification. Please contact staff.',
        flags: 64
      });
    }
  }
}

// Command Definitions - All features except leveling
const commands = [
  // 🎪 General Commands
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
          { name: '🎪 General', value: '`/ping`, `/help`, `/server-info`, `/user-info`, `/avatar`, `/membercount`', inline: false },
          { name: '🎵 Music', value: '`/join`, `/leave`, `/play`, `/skip`, `/stop`, `/queue`, `/volume`, `/nowplaying`, `/shuffle`', inline: false },
          { name: '🛡️ Moderation', value: '`/automod`, `/warn`, `/warnings`, `/clearwarnings`, `/clear`, `/slowmode`', inline: false },
          { name: '⚙️ Admin', value: '`/setup-automated`, `/setwelcome`, `/setgoodbye`, `/setup-verification`, `/rules`, `/config`', inline: false }
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
        .setTitle(`📊 ${guild.name} Server Info`)
        .setColor(0x3498DB)
        .setThumbnail(guild.iconURL())
        .addFields(
          { name: '👑 Owner', value: `${owner.user.tag}`, inline: true },
          { name: '🆔 Server ID', value: guild.id, inline: true },
          { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
          { name: '📈 Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
          { name: '🔐 Verification', value: `${guild.verificationLevel || 'None'}`, inline: true },
          { name: '💬 Channels', value: `${guild.channels.cache.size}`, inline: true },
          { name: '🎭 Roles', value: `${guild.roles.cache.size}`, inline: true },
          { name: '😄 Emojis', value: `${guild.emojis.cache.size}`, inline: true }
        )
        .setFooter({ text: `Server • ${guild.name}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'user-info',
    description: 'Get information about a user',
    options: [
      {
        name: 'user', type: 6, description: 'The user to get info about', required: false
      }
    ],
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const member = interaction.guild.members.cache.get(user.id);
      
      if (!member) {
        return interaction.reply({ content: '❌ User not found in this server.', flags: 64 });
      }

      const embed = new EmbedBuilder()
        .setTitle(`👤 ${user.tag}`)
        .setColor(0x3498DB)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: '🆔 User ID', value: user.id, inline: true },
          { name: '📅 Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '📥 Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
          { name: '🎭 Roles', value: `${member.roles.cache.size - 1}`, inline: true },
          { name: '🎨 Highest Role', value: `${member.roles.highest}`, inline: true },
          { name: '🤖 Bot', value: user.bot ? '✅ Yes' : '❌ No', inline: true }
        )
        .setFooter({ text: `User Info • ${user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'avatar',
    description: "Get a user's avatar",
    options: [
      {
        name: 'user', type: 6, description: 'The user to get the avatar of', required: false
      }
    ],
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      
      const embed = new EmbedBuilder()
        .setTitle(`🖼️ ${user.username}'s Avatar`)
        .setColor(0x3498DB)
        .setImage(user.displayAvatarURL({ size: 4096 }))
        .addFields(
          { name: '🔗 PNG', value: `[Link](${user.displayAvatarURL({ format: 'png', size: 4096 })})`, inline: true },
          { name: '🔗 JPG', value: `[Link](${user.displayAvatarURL({ format: 'jpg', size: 4096 })})`, inline: true },
          { name: '🔗 WEBP', value: `[Link](${user.displayAvatarURL({ format: 'webp', size: 4096 })})`, inline: true }
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'membercount',
    description: 'Show the current member count',
    async execute(interaction) {
      const guild = interaction.guild;
      const members = await guild.members.fetch();
      const bots = members.filter(m => m.user.bot).size;
      const humans = members.filter(m => !m.user.bot).size;
      
      const embed = new EmbedBuilder()
        .setTitle(`👥 ${guild.name} Member Count`)
        .setColor(0x3498DB)
        .setThumbnail(guild.iconURL())
        .addFields(
          { name: '👤 Total Members', value: `${guild.memberCount}`, inline: true },
          { name: '😊 Humans', value: `${humans}`, inline: true },
          { name: '🤖 Bots', value: `${bots}`, inline: true }
        )
        .setFooter({ text: `Member Count • ${guild.name}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },

  // 🎵 Music Commands (Fixed)
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
        return interaction.reply({ content: '❌ Please select a voice channel!', flags: 64 });
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

      // Enhanced URL validation
      const urlValidation = validateYouTubeUrl(url);
      if (!urlValidation.isValid && !ytdl.validateURL(url)) {
        return interaction.editReply('❌ Please provide a valid YouTube URL!\n\nSupported formats:\n• https://www.youtube.com/watch?v=VIDEO_ID\n• https://youtu.be/VIDEO_ID\n• https://www.youtube.com/embed/VIDEO_ID');
      }

      const finalUrl = urlValidation.isValid ? urlValidation.normalizedUrl : url;

      try {
        // Get video info first with timeout
        const info = await Promise.race([
          ytdl.getInfo(finalUrl),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('YouTube request timeout')), 10000)
          )
        ]);

        // Check if video is playable
        if (info.videoDetails.isLive) {
          return interaction.editReply('❌ Live streams are not supported!');
        }

        if (parseInt(info.videoDetails.lengthSeconds) > 36000) { // 10 hours
          return interaction.editReply('❌ Videos longer than 10 hours are not supported!');
        }

        const song = {
          url: finalUrl,
          title: info.videoDetails.title,
          duration: parseInt(info.videoDetails.lengthSeconds),
          thumbnail: info.videoDetails.thumbnails[0]?.url,
          requestedBy: interaction.user.tag,
          durationFormatted: MusicSystem.formatDuration(parseInt(info.videoDetails.lengthSeconds))
        };

        // Join voice channel if not connected
        if (!voiceConnections.has(interaction.guild.id)) {
          const joined = await joinVoice(interaction.guild.id, voiceChannel.id);
          if (!joined) {
            return interaction.editReply('❌ Failed to join voice channel! Please check my permissions.');
          }
          // Small delay to ensure connection is ready
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const position = await MusicSystem.addToQueue(interaction.guild.id, song);
        
        const embed = new EmbedBuilder()
          .setTitle('🎵 Added to Queue')
          .setColor(0x1DB954)
          .setDescription(`**[${song.title}](${finalUrl})**`)
          .addFields(
            { name: 'Duration', value: song.durationFormatted, inline: true },
            { name: 'Requested By', value: interaction.user.tag, inline: true },
            { name: 'Position in Queue', value: `#${position}`, inline: true }
          )
          .setThumbnail(song.thumbnail)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error in play command:', error);
        
        let errorMessage = '❌ Failed to play the song. ';
        
        if (error.message.includes('timeout')) {
          errorMessage += 'YouTube took too long to respond. Please try again.';
        } else if (error.message.includes('Video unavailable')) {
          errorMessage += 'This video is unavailable or restricted.';
        } else if (error.message.includes('Private video')) {
          errorMessage += 'This video is private.';
        } else if (error.message.includes('Sign in to confirm')) {
          errorMessage += 'This video is age-restricted and cannot be played.';
        } else {
          errorMessage += 'Please try a different URL or try again later.';
        }
        
        await interaction.editReply(errorMessage);
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
        `**${index + 1}.** ${song.title} - ${song.requestedBy} (${song.durationFormatted})`
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
          { name: 'Duration', value: nowPlaying.durationFormatted, inline: true },
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
    name: 'shuffle',
    description: 'Shuffle the current music queue',
    async execute(interaction) {
      const shuffled = MusicSystem.shuffleQueue(interaction.guild.id);
      
      if (shuffled) {
        await interaction.reply('🔀 Shuffled the queue!');
      } else {
        await interaction.reply('❌ No songs in queue to shuffle.');
      }
    }
  },

  // 🛡️ Moderation Commands
  {
    name: 'automod',
    description: 'Configure auto moderation',
    options: [
      {
        name: 'action', type: 3, description: 'What automod should do', required: true,
        choices: [
          { name: 'Toggle', value: 'toggle' }, { name: 'Status', value: 'status' }, { name: 'Set Action', value: 'setaction' },
          { name: 'Set Log Channel', value: 'setlog' }, { name: 'Add Word', value: 'addword' },
          { name: 'Remove Word', value: 'removeword' }, { name: 'List Words', value: 'listwords' }
        ]
      },
      { name: 'value', type: 3, description: 'Value for setaction or word to add/remove', required: false },
      { name: 'channel', type: 7, description: 'Channel for moderation logs', required: false, channel_types: [0] }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', flags: 64 });
      }

      const action = interaction.options.getString('action');
      const value = interaction.options.getString('value');
      const channel = interaction.options.getChannel('channel');

      let embed;

      switch (action) {
        case 'toggle':
          const newStatus = AutoModSystem.toggle(interaction.guild.id);
          embed = new EmbedBuilder()
            .setTitle('🛡️ Auto-Moderation')
            .setColor(newStatus ? 0x00FF00 : 0xFF0000)
            .setDescription(`Auto-moderation has been **${newStatus ? 'ENABLED' : 'DISABLED'}**`)
            .addFields(
              { name: 'Status', value: newStatus ? '✅ Enabled' : '❌ Disabled', inline: true },
              { name: 'Banned Words', value: `${AutoModSystem.getBannedWords(interaction.guild.id).length}`, inline: true }
            );
          break;

        case 'status':
          const isEnabled = AutoModSystem.isEnabled(interaction.guild.id);
          const words = AutoModSystem.getBannedWords(interaction.guild.id);
          embed = new EmbedBuilder()
            .setTitle('🛡️ Auto-Moderation Status')
            .setColor(isEnabled ? 0x00FF00 : 0xFF0000)
            .addFields(
              { name: 'Status', value: isEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
              { name: 'Banned Words', value: `${words.length}`, inline: true },
              { name: 'Words List', value: words.length > 0 ? words.join(', ') : 'No words added', inline: false }
            );
          break;

        case 'addword':
          if (!value) {
            return interaction.reply({ content: '❌ Please provide a word to add.', flags: 64 });
          }
          const added = AutoModSystem.addBannedWord(interaction.guild.id, value);
          embed = new EmbedBuilder()
            .setTitle('🛡️ Auto-Moderation')
            .setColor(added ? 0x00FF00 : 0xFF0000)
            .setDescription(added ? `✅ Added "${value}" to banned words` : `❌ "${value}" is already in the list`);
          break;

        case 'removeword':
          if (!value) {
            return interaction.reply({ content: '❌ Please provide a word to remove.', flags: 64 });
          }
          const removed = AutoModSystem.removeBannedWord(interaction.guild.id, value);
          embed = new EmbedBuilder()
            .setTitle('🛡️ Auto-Moderation')
            .setColor(removed ? 0x00FF00 : 0xFF0000)
            .setDescription(removed ? `✅ Removed "${value}" from banned words` : `❌ "${value}" not found in the list`);
          break;

        case 'listwords':
          const bannedWords = AutoModSystem.getBannedWords(interaction.guild.id);
          embed = new EmbedBuilder()
            .setTitle('🛡️ Banned Words List')
            .setColor(0x3498DB)
            .setDescription(bannedWords.length > 0 ? bannedWords.join(', ') : 'No banned words configured')
            .addFields(
              { name: 'Total Words', value: `${bannedWords.length}`, inline: true }
            );
          break;

        case 'setlog':
          if (!channel) {
            return interaction.reply({ content: '❌ Please provide a channel.', flags: 64 });
          }
          const config = getServerConfig(interaction.guild.id);
          config.logChannel = channel.id;
          await saveConfig();
          embed = new EmbedBuilder()
            .setTitle('🛡️ Auto-Moderation')
            .setColor(0x00FF00)
            .setDescription(`✅ Log channel set to ${channel}`);
          break;

        default:
          return interaction.reply({ content: '❌ Invalid action.', flags: 64 });
      }

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'warn',
    description: 'Warn a user for rule violation',
    options: [
      { name: 'user', type: 6, description: 'The user to warn', required: true },
      { name: 'reason', type: 3, description: 'Reason for the warning', required: true }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({ content: '❌ You need moderation permissions.', flags: 64 });
      }

      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      const warningCount = AutoModSystem.addWarning(interaction.guild.id, user.id, reason);

      const embed = new EmbedBuilder()
        .setTitle('⚠️ User Warned')
        .setColor(0xFFA500)
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Warned By', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason, inline: false },
          { name: 'Total Warnings', value: `${warningCount}`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Log the warning
      const config = getServerConfig(interaction.guild.id);
      if (config.logChannel) {
        const logChannel = interaction.guild.channels.cache.get(config.logChannel);
        if (logChannel) {
          await logChannel.send({ embeds: [embed] });
        }
      }
    }
  },
  {
    name: 'warnings',
    description: 'Check warnings for a user',
    options: [
      { name: 'user', type: 6, description: 'The user to check warnings for', required: false }
    ],
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const warnings = AutoModSystem.getWarnings(interaction.guild.id, user.id);

      const embed = new EmbedBuilder()
        .setTitle(`⚠️ Warnings for ${user.tag}`)
        .setColor(0xFFA500)
        .addFields(
          { name: 'Total Warnings', value: `${warnings.length}`, inline: true }
        );

      if (warnings.length > 0) {
        warnings.slice(0, 10).forEach((warning, index) => {
          embed.addFields({
            name: `Warning ${index + 1}`,
            value: `**Reason:** ${warning.reason}\n**By:** ${warning.moderator}\n**When:** <t:${Math.floor(warning.timestamp / 1000)}:R>`,
            inline: false
          });
        });
      } else {
        embed.setDescription('No warnings found for this user.');
      }

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'clearwarnings',
    description: 'Clear all warnings for a user',
    options: [
      { name: 'user', type: 6, description: 'The user to clear warnings for', required: true }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({ content: '❌ You need moderation permissions.', flags: 64 });
      }

      const user = interaction.options.getUser('user');
      const cleared = AutoModSystem.clearWarnings(interaction.guild.id, user.id);

      const embed = new EmbedBuilder()
        .setTitle('⚠️ Warnings Cleared')
        .setColor(cleared ? 0x00FF00 : 0xFF0000)
        .setDescription(cleared ? `✅ Cleared all warnings for ${user.tag}` : `❌ No warnings found for ${user.tag}`)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'clear',
    description: 'Clear messages from a channel',
    options: [
      {
        name: 'amount', type: 4, description: 'Number of messages to clear (1-100)', required: true,
        min_value: 1, max_value: 100
      }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.reply({ content: '❌ You need manage messages permissions.', flags: 64 });
      }

      const amount = interaction.options.getInteger('amount');

      try {
        const messages = await interaction.channel.bulkDelete(amount, true);
        await interaction.reply(`✅ Cleared ${messages.size} messages!`);
        
        // Auto-delete the success message after 5 seconds
        setTimeout(async () => {
          try {
            await interaction.deleteReply();
          } catch (error) {
            // Message already deleted or inaccessible
          }
        }, 5000);

      } catch (error) {
        console.error('Error clearing messages:', error);
        await interaction.reply({ content: '❌ Failed to clear messages. Make sure they are not older than 14 days.', flags: 64 });
      }
    }
  },
  {
    name: 'slowmode',
    description: 'Set slowmode for the current channel',
    options: [
      {
        name: 'seconds', type: 4, description: 'Slowmode duration in seconds (0-21600)', required: true,
        min_value: 0, max_value: 21600
      }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.reply({ content: '❌ You need manage channels permissions.', flags: 64 });
      }

      const seconds = interaction.options.getInteger('seconds');

      try {
        await interaction.channel.setRateLimitPerUser(seconds);
        await interaction.reply(seconds === 0 ? '✅ Slowmode disabled!' : `✅ Slowmode set to ${seconds} seconds!`);
      } catch (error) {
        console.error('Error setting slowmode:', error);
        await interaction.reply({ content: '❌ Failed to set slowmode.', flags: 64 });
      }
    }
  },

  // ⚙️ Admin Commands
  {
    name: 'setup-automated',
    description: 'Set up all automated systems with one command',
    options: [
      {
        name: 'level_channel', type: 7, description: 'Channel for level-up notifications', required: true, channel_types: [0]
      },
      {
        name: 'music_channel', type: 7, description: 'Channel for music commands', required: false, channel_types: [0]
      },
      {
        name: 'log_channel', type: 7, description: 'Channel for moderation logs', required: false, channel_types: [0]
      },
      {
        name: 'new_role', type: 8, description: 'Role for new members (Level 1)', required: false
      },
      {
        name: 'member_role', type: 8, description: 'Role for members (Level 10)', required: false
      },
      {
        name: 'shadow_role', type: 8, description: 'Role for shadows (Level 25)', required: false
      }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', flags: 64 });
      }

      await interaction.deferReply();

      const levelChannel = interaction.options.getChannel('level_channel');
      const musicChannel = interaction.options.getChannel('music_channel');
      const logChannel = interaction.options.getChannel('log_channel');
      const newRole = interaction.options.getRole('new_role');
      const memberRole = interaction.options.getRole('member_role');
      const shadowRole = interaction.options.getRole('shadow_role');

      const config = getServerConfig(interaction.guild.id);
      
      let setupResults = [];

      if (levelChannel) {
        config.welcomeChannel = levelChannel.id;
        setupResults.push('✅ Welcome channel set');
      }

      if (logChannel) {
        config.logChannel = logChannel.id;
        setupResults.push('✅ Log channel set');
      }

      await saveConfig();

      // Enable auto-mod
      AutoModSystem.toggle(interaction.guild.id);
      setupResults.push('✅ Auto-moderation enabled');

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Automated Setup Complete')
        .setColor(0x00FF00)
        .setDescription('The following features have been configured:')
        .addFields(
          { name: 'Setup Results', value: setupResults.join('\n') || 'No features configured', inline: false }
        )
        .setFooter({ text: 'Use /config to view current settings' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },
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
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', flags: 64 });
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
        name: 'channel', type: 7, description: 'The channel to send goodbye messages to', required: true, channel_types: [0]
      },
      {
        name: 'message', type: 3, description: 'Custom goodbye message (use {user} for mention, {server} for server name, {count} for member count)', required: false
      }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', flags: 64 });
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
    name: 'setup-verification',
    description: 'Set up verification system for new members',
    options: [
      { name: 'channel', type: 7, description: 'Channel for verification', required: true, channel_types: [0] },
      { name: 'role', type: 8, description: 'Role to assign after verification', required: true }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', flags: 64 });
      }

      await interaction.deferReply();

      const channel = interaction.options.getChannel('channel');
      const role = interaction.options.getRole('role');

      const success = await VerificationSystem.setupVerification(interaction.guild.id, channel.id, role.id);

      const embed = new EmbedBuilder()
        .setTitle(success ? '✅ Verification System Setup' : '❌ Setup Failed')
        .setColor(success ? 0x00FF00 : 0xFF0000)
        .setDescription(success ? 
          `Verification system has been set up in ${channel}. Users can click the verify button to get the ${role} role.` :
          'Failed to set up verification system. Please check channel and role permissions.'
        )
        .addFields(
          { name: 'Verification Channel', value: `${channel}`, inline: true },
          { name: 'Verification Role', value: `${role}`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },
  {
    name: 'rules',
    description: 'Manage server rules',
    options: [
      {
        name: 'action', type: 3, description: 'Action to perform', required: true,
        choices: [
          { name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'List', value: 'list' },
          { name: 'Set Channel', value: 'setchannel' }, { name: 'Clear', value: 'clear' }, { name: 'Post', value: 'post' }
        ]
      },
      { name: 'text', type: 3, description: 'Rule text (for add)', required: false },
      { name: 'index', type: 4, description: 'Rule index (for remove)', required: false },
      { name: 'channel', type: 7, description: 'Channel to post rules', required: false, channel_types: [0] }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', flags: 64 });
      }

      const action = interaction.options.getString('action');
      const text = interaction.options.getString('text');
      const index = interaction.options.getInteger('index');
      const channel = interaction.options.getChannel('channel');

      let embed;

      switch (action) {
        case 'add':
          if (!text) {
            return interaction.reply({ content: '❌ Please provide rule text.', flags: 64 });
          }
          const ruleNumber = RulesSystem.addRule(interaction.guild.id, text);
          embed = new EmbedBuilder()
            .setTitle('📜 Rules Management')
            .setColor(0x00FF00)
            .setDescription(`✅ Added rule ${ruleNumber}: ${text}`);
          break;

        case 'remove':
          if (!index) {
            return interaction.reply({ content: '❌ Please provide rule index to remove.', flags: 64 });
          }
          const removed = RulesSystem.removeRule(interaction.guild.id, index);
          embed = new EmbedBuilder()
            .setTitle('📜 Rules Management')
            .setColor(removed ? 0x00FF00 : 0xFF0000)
            .setDescription(removed ? `✅ Removed rule ${index}` : `❌ Rule ${index} not found`);
          break;

        case 'list':
          const rules = RulesSystem.getRules(interaction.guild.id);
          embed = new EmbedBuilder()
            .setTitle('📜 Server Rules')
            .setColor(0x3498DB)
            .setDescription(rules.length > 0 ? rules.map((rule, i) => `**${i + 1}.** ${rule}`).join('\n') : 'No rules set')
            .addFields({ name: 'Total Rules', value: `${rules.length}`, inline: true });
          break;

        case 'clear':
          RulesSystem.clearRules(interaction.guild.id);
          embed = new EmbedBuilder()
            .setTitle('📜 Rules Management')
            .setColor(0x00FF00)
            .setDescription('✅ Cleared all rules');
          break;

        case 'post':
          if (!channel) {
            return interaction.reply({ content: '❌ Please provide a channel to post rules.', flags: 64 });
          }
          const posted = await RulesSystem.postRules(interaction.guild.id, channel);
          embed = new EmbedBuilder()
            .setTitle('📜 Rules Management')
            .setColor(posted ? 0x00FF00 : 0xFF0000)
            .setDescription(posted ? `✅ Rules posted in ${channel}` : '❌ No rules to post');
          break;

        default:
          return interaction.reply({ content: '❌ Invalid action.', flags: 64 });
      }

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'config',
    description: 'View the current bot configuration',
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', flags: 64 });
      }

      const config = getServerConfig(interaction.guild.id);
      const autoModStatus = AutoModSystem.isEnabled(interaction.guild.id);
      const bannedWordsCount = AutoModSystem.getBannedWords(interaction.guild.id).length;
      const rulesCount = RulesSystem.getRules(interaction.guild.id).length;

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Server Configuration')
        .setColor(0x3498DB)
        .addFields(
          { name: 'Welcome Channel', value: config.welcomeChannel ? `<#${config.welcomeChannel}>` : '❌ Not set', inline: true },
          { name: 'Goodbye Channel', value: config.goodbyeChannel ? `<#${config.goodbyeChannel}>` : '❌ Not set', inline: true },
          { name: 'Log Channel', value: config.logChannel ? `<#${config.logChannel}>` : '❌ Not set', inline: true },
          { name: 'Auto Role', value: config.autoRole ? `<@&${config.autoRole}>` : '❌ Not set', inline: true },
          { name: 'Verification Channel', value: config.verificationChannel ? `<#${config.verificationChannel}>` : '❌ Not set', inline: true },
          { name: 'Verification Role', value: config.verificationRole ? `<@&${config.verificationRole}>` : '❌ Not set', inline: true },
          { name: 'Welcome Messages', value: config.enableWelcome ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: 'Goodbye Messages', value: config.enableGoodbye ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: 'Auto-Moderation', value: autoModStatus ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: 'Banned Words', value: `${bannedWordsCount}`, inline: true },
          { name: 'Server Rules', value: `${rulesCount}`, inline: true }
        )
        .setFooter({ text: 'Use /setup-automated to configure multiple features' })
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

// Health check endpoints
app.get('/quick-health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    bot: client?.user ? 'ready' : 'starting'
  });
});

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

// Deploy commands function
async function deployCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    
    console.log('🔄 Started refreshing application (/) commands.');

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

// Message content handler for auto-moderation
client.on('messageCreate', async (message) => {
  // Ignore bot messages and DMs
  if (message.author.bot || !message.guild) return;

  // Auto-moderation check
  const bannedWord = AutoModSystem.checkMessage(message.content, message.guild.id);
  if (bannedWord) {
    await AutoModSystem.handleViolation(message, bannedWord);
    return;
  }

  // Basic message commands
  if (message.content === '!ping') {
    const sent = await message.reply('Pinging... 🏓');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const apiLatency = Math.round(client.ws.ping);

    await sent.edit(`🏓 Pong!\n• Bot Latency: ${latency}ms\n• API Latency: ${apiLatency}ms`);
  }

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

// Button interactions (for verification)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    if (interaction.customId === 'verify_user') {
      await VerificationSystem.handleVerification(interaction);
    }
  } catch (error) {
    console.error('Button interaction error:', error);
  }
});

// Event Handlers
client.once('ready', async (c) => {
  console.log(`✅ Bot is ready! Logged in as ${c.user.tag}`);
  const serverCount = c.guilds.cache.size;
  console.log(`📊 Serving ${serverCount} server(s)`);
  console.log(`🔄 Loaded ${client.commands.size} commands`);
  console.log(`🌐 Health check server running on port ${PORT}`);

  // Set activity
  client.user.setActivity({
    name: `${serverCount} servers | /help`,
    type: ActivityType.Watching
  });

  console.log(`🎯 Activity set: Watching ${serverCount} servers`);

  // Auto-deploy commands on startup
  if (process.env.NODE_ENV === 'production') {
    console.log('🚀 Starting async command deployment...');
    
    deployCommands().then(() => {
      console.log('✅ Commands deployed successfully');
    }).catch(error => {
      console.error('❌ Command deployment failed:', error.message);
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

// Unified interaction handler for slash commands
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      console.log(`🔧 Executing command: /${interaction.commandName} by ${interaction.user.tag}`);

      await command.execute(interaction);
    }
  } catch (error) {
    console.error(`❌ Interaction error:`, error);
    
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
  process.exit(1);
}

// Login to Discord
console.log('🔐 Attempting to login to Discord...');
client.login(token).catch(error => {
  console.error('❌ Failed to login:', error.message);
  process.exit(1);
});