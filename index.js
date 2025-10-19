// Load environment variables FIRST
require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, REST, Routes, ChannelType } = require('discord.js');
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
    GatewayIntentBits.GuildPresences,
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

// Enhanced banned words (Arabic and English)
const GLOBAL_BANNED_WORDS = {
  english: [
    'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'whore', 'slut',
    'nigger', 'nigga', 'chink', 'spic', 'kike', 'fag', 'faggot',
    'kill yourself', 'kys', 'die', 'retard', 'mongoloid'
  ],
  arabic: [
    'كس', 'طيز', 'زبر', 'شرموط', 'عاهر', 'قحبة', 'دعارة',
    'كسم', 'كسمك', 'كسمكم', 'ابن المتناكة', 'ابن الكلب',
    'حمار', 'كلب', 'غبي', 'عبيط', 'هطل', 'لحس', 'يلعن',
    'كفر', 'ملحد', 'زنديق', 'يلعن دين', 'طائفي'
  ]
};

// Voice connection storage
const voiceConnections = new Map();
const audioPlayers = new Map();
const musicQueues = new Map();

// User cooldowns for spam protection
const userCooldowns = new Map();
const messageCounts = new Map();

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
      rulesMessageId: null,
      modLogChannel: null,
      warnings: {},
      automod: {
        enabled: true,
        bannedWords: [],
        action: 'warn',
        strikeLimit: 5,
        muteDurationMs: 10 * 60 * 1000,
        antiSpam: true,
        antiLinks: true,
        antiMention: true,
        maxMentions: 5,
        antiCaps: true,
        capsPercentage: 70,
        antiInvites: true
      },
      verification: {
        enabled: false,
        role: null,
        channel: null,
        messageId: null
      },
      leveling: {
        enabled: true,
        levelUpChannel: null,
        rewards: {
          new: process.env.ROLE_NEW || null,
          member: process.env.ROLE_MEMBER || null,
          shadow: process.env.ROLE_SHADOW || null
        },
        thresholds: {
          member: parseInt(process.env.LEVEL_THRESHOLD_MEMBER) || 10,
          shadow: parseInt(process.env.LEVEL_THRESHOLD_SHADOW) || 25
        },
        xpPerMessage: 15,
        xpCooldown: 60000
      },
      music: {
        enabled: true,
        textChannel: null,
        defaultVolume: 50
      }
    };
  }
  return serverConfigs[guildId];
}

// Enhanced Leveling System
class LevelingSystem {
  static getUserKey(userId, guildId) {
    return `user_${userId}_${guildId}`;
  }

  static getUserData(userId, guildId) {
    const key = this.getUserKey(userId, guildId);
    return quickdb.get(key) || { xp: 0, level: 1, lastMessage: 0 };
  }

  static saveUserData(userId, guildId, data) {
    const key = this.getUserKey(userId, guildId);
    quickdb.set(key, data);
  }

  static calculateLevel(xp) {
    return Math.floor(0.1 * Math.sqrt(xp)) + 1;
  }

  static calculateXPRequired(level) {
    return Math.pow((level - 1) / 0.1, 2);
  }

  static async addXP(userId, guildId, xpToAdd = 15) {
    const userData = this.getUserData(userId, guildId);
    const now = Date.now();
    const config = getServerConfig(guildId);
    const cooldown = config.leveling.xpCooldown || 60000;

    if (now - userData.lastMessage < cooldown) {
      return { leveledUp: false, newLevel: userData.level };
    }

    userData.xp += xpToAdd;
    userData.lastMessage = now;

    const newLevel = this.calculateLevel(userData.xp);
    const leveledUp = newLevel > userData.level;

    if (leveledUp) {
      userData.level = newLevel;
    }

    this.saveUserData(userId, guildId, userData);
    return { leveledUp, newLevel, xp: userData.xp };
  }

  static async handleLevelUp(member, newLevel, config) {
    try {
      const guild = member.guild;
      
      const newRoleId = config.leveling.rewards.new;
      const memberRoleId = config.leveling.rewards.member;
      const shadowRoleId = config.leveling.rewards.shadow;

      const memberThreshold = config.leveling.thresholds.member;
      const shadowThreshold = config.leveling.thresholds.shadow;

      let roleToAdd = null;
      let roleToRemove = null;
      let message = '';

      if (newLevel >= shadowThreshold && shadowRoleId) {
        roleToAdd = shadowRoleId;
        roleToRemove = memberRoleId;
        message = `🎉 **Congratulations ${member.user}!** You've reached level ${newLevel} and earned the **Shadow** role! 🏆`;
      } else if (newLevel >= memberThreshold && memberRoleId) {
        roleToAdd = memberRoleId;
        roleToRemove = newRoleId;
        message = `🎉 **Congratulations ${member.user}!** You've reached level ${newLevel} and earned the **Member** role! ⭐`;
      }

      if (roleToAdd) {
        const role = guild.roles.cache.get(roleToAdd);
        if (role) {
          await member.roles.add(role);
          
          if (roleToRemove) {
            const oldRole = guild.roles.cache.get(roleToRemove);
            if (oldRole && member.roles.cache.has(oldRole.id)) {
              await member.roles.remove(oldRole);
            }
          }
        }
      }

      const levelUpChannelId = config.leveling.levelUpChannel;
      if (levelUpChannelId && message) {
        const channel = guild.channels.cache.get(levelUpChannelId);
        if (channel) {
          await channel.send(message);
        }
      }

      return { roleAssigned: roleToAdd, message };
    } catch (error) {
      console.error('Error handling level up:', error);
      return { roleAssigned: null, message: '' };
    }
  }

  static getLeaderboard(guildId, limit = 10) {
    const allData = quickdb.all();
    const guildData = allData.filter(data => data.ID.includes(guildId));
    
    return guildData
      .map(data => {
        const userId = data.ID.split('_')[1];
        return { userId, ...data.data };
      })
      .sort((a, b) => b.xp - a.xp)
      .slice(0, limit);
  }
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

// Enhanced Auto-Moderation Functions
function containsBannedWords(text, config) {
  const lowerText = text.toLowerCase();
  const allBannedWords = [
    ...GLOBAL_BANNED_WORDS.english,
    ...GLOBAL_BANNED_WORDS.arabic,
    ...config.automod.bannedWords
  ];

  for (const word of allBannedWords) {
    if (word && lowerText.includes(word.toLowerCase())) {
      return { found: true, word: word };
    }
  }
  return { found: false };
}

function hasExcessiveCaps(text, percentage = 70) {
  if (text.length < 10) return false;
  const capsCount = (text.match(/[A-Z]/g) || []).length;
  const capsPercentage = (capsCount / text.length) * 100;
  return capsPercentage > percentage;
}

function hasExcessiveMentions(text, maxMentions = 5) {
  const mentionCount = (text.match(/@/g) || []).length;
  return mentionCount > maxMentions;
}

function containsInviteLinks(text) {
  const inviteRegex = /(discord\.gg\/|discordapp\.com\/invite\/|discord\.com\/invite\/)/i;
  return inviteRegex.test(text);
}

function isSpam(userId, guildId) {
  const key = `${guildId}-${userId}`;
  const now = Date.now();
  
  if (!messageCounts.has(key)) {
    messageCounts.set(key, []);
  }
  
  const userMessages = messageCounts.get(key);
  userMessages.push(now);
  
  const recentMessages = userMessages.filter(time => now - time < 5000);
  messageCounts.set(key, recentMessages);
  
  return recentMessages.length > 5;
}

async function handleModAction(message, reason, config) {
  try {
    const userId = message.author.id;
    const guildId = message.guild.id;
    
    if (!serverConfigs[guildId].warnings[userId]) {
      serverConfigs[guildId].warnings[userId] = 0;
    }
    
    serverConfigs[guildId].warnings[userId]++;
    const strikes = serverConfigs[guildId].warnings[userId];

    try {
      await message.delete();
    } catch (error) {
      console.log('Could not delete message:', error.message);
    }

    const logEmbed = new EmbedBuilder()
      .setTitle('🛡️ Auto-Moderation Action')
      .setColor(0xFF6B6B)
      .addFields(
        { name: '👤 User', value: `${message.author.tag} (${message.author.id})`, inline: true },
        { name: '📝 Channel', value: `${message.channel}`, inline: true },
        { name: '🚫 Reason', value: reason, inline: true },
        { name: '⚠️ Strikes', value: `${strikes}/${config.automod.strikeLimit}`, inline: true }
      )
      .setFooter({ text: 'Auto-Moderation System' })
      .setTimestamp();

    try {
      const userEmbed = new EmbedBuilder()
        .setTitle('⚠️ Auto-Moderation Warning')
        .setColor(0xFFA500)
        .setDescription(`You have been warned in **${message.guild.name}**`)
        .addFields(
          { name: 'Reason', value: reason, inline: true },
          { name: 'Strikes', value: `${strikes}/${config.automod.strikeLimit}`, inline: true }
        )
        .setFooter({ text: 'Please follow the server rules' })
        .setTimestamp();
      
      await message.author.send({ embeds: [userEmbed] });
    } catch (error) {
      logEmbed.addFields({ name: '📨 DM Status', value: 'Failed to send DM', inline: true });
    }

    await sendModLog(message.guild, logEmbed);

    if (strikes >= config.automod.strikeLimit) {
      await executeModAction(message.member, config.automod.action, config);
      serverConfigs[guildId].warnings[userId] = 0;
    }

    await saveConfig();

  } catch (error) {
    console.error('Error in handleModAction:', error);
  }
}

async function executeModAction(member, action, config) {
  try {
    switch (action) {
      case 'mute':
        if (member.moderatable) {
          await member.timeout(config.automod.muteDurationMs, 'Auto-mod: Strike limit reached');
          return `Muted for ${config.automod.muteDurationMs / 60000} minutes`;
        }
        break;
      case 'kick':
        if (member.kickable) {
          await member.kick('Auto-mod: Strike limit reached');
          return 'Kicked from server';
        }
        break;
      case 'ban':
        if (member.bannable) {
          await member.ban({ reason: 'Auto-mod: Strike limit reached' });
          return 'Banned from server';
        }
        break;
      default:
        return 'Warned';
    }
  } catch (error) {
    console.error('Error executing mod action:', error);
    return 'Action failed';
  }
}

async function sendModLog(guild, embed) {
  try {
    const config = getServerConfig(guild.id);
    if (!config.modLogChannel) return;
    
    const logChannel = guild.channels.cache.get(config.modLogChannel);
    if (logChannel) {
      await logChannel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Error sending mod log:', error);
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

// Enhanced Auto-Moderation Message Handler
async function handleAutoMod(message) {
  if (!message.guild || message.author.bot) return;
  
  const config = getServerConfig(message.guild.id);
  if (!config.automod.enabled) return;

  const content = message.content;
  const violations = [];

  const bannedWordCheck = containsBannedWords(content, config);
  if (bannedWordCheck.found) {
    violations.push(`Banned word: "${bannedWordCheck.word}"`);
  }

  if (config.automod.antiSpam && isSpam(message.author.id, message.guild.id)) {
    violations.push('Spam detection (too many messages in short time)');
  }

  if (config.automod.antiMention && hasExcessiveMentions(content, config.automod.maxMentions)) {
    violations.push(`Excessive mentions (more than ${config.automod.maxMentions})`);
  }

  if (config.automod.antiCaps && hasExcessiveCaps(content, config.automod.capsPercentage)) {
    violations.push('Excessive capital letters');
  }

  if (config.automod.antiInvites && containsInviteLinks(content)) {
    violations.push('Discord invite links');
  }

  if (violations.length > 0) {
    await handleModAction(message, violations.join(', '), config);
  }
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
      const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Help Menu')
        .setColor(0x3498DB)
        .setDescription('Here are all available commands!')
        .addFields(
          { name: '🎪 General', value: '`/ping`, `/help`, `/server-info`, `/user-info`, `/avatar`, `/membercount`', inline: false },
          { name: '🛠️ Moderation', value: '`/clear`, `/slowmode`, `/warn`, `/mute`, `/unmute`, `/warnings`, `/clearwarnings`', inline: false },
          { name: '⚙️ Admin', value: '`/setwelcome`, `/setgoodbye`, `/config`, `/spotify`, `/rules`, `/automod`, `/setup-verification`, `/setup-automated`', inline: false },
          { name: '🎵 Music', value: '`/play`, `/skip`, `/stop`, `/queue`, `/volume`, `/nowplaying`', inline: false },
          { name: '📊 Leveling', value: '`/level`, `/leaderboard`, `/leveling-setup`', inline: false }
        )
        .setFooter({ text: 'Use slash commands (/) to interact with the bot!' });

      await interaction.reply({ embeds: [embed] });
    }
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
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', ephemeral: true });
      }

      const levelChannel = interaction.options.getChannel('level_channel');
      const musicChannel = interaction.options.getChannel('music_channel');
      const logChannel = interaction.options.getChannel('log_channel');
      const newRole = interaction.options.getRole('new_role');
      const memberRole = interaction.options.getRole('member_role');
      const shadowRole = interaction.options.getRole('shadow_role');

      const config = getServerConfig(interaction.guild.id);

      // Setup leveling system
      config.leveling.enabled = true;
      config.leveling.levelUpChannel = levelChannel.id;
      if (newRole) config.leveling.rewards.new = newRole.id;
      if (memberRole) config.leveling.rewards.member = memberRole.id;
      if (shadowRole) config.leveling.rewards.shadow = shadowRole.id;

      // Setup music system
      config.music.enabled = true;
      if (musicChannel) config.music.textChannel = musicChannel.id;

      // Setup moderation
      if (logChannel) config.modLogChannel = logChannel.id;
      config.automod.enabled = true;

      await saveConfig();

      const embed = new EmbedBuilder()
        .setTitle('✅ Automated Systems Setup Complete!')
        .setColor(0x2ECC71)
        .setDescription('All automated systems have been configured and are now active!')
        .addFields(
          { name: '📊 Leveling System', value: `✅ Enabled\n📁 Channel: ${levelChannel}`, inline: true },
          { name: '🎵 Music System', value: musicChannel ? `✅ Enabled\n📁 Channel: ${musicChannel}` : '✅ Enabled', inline: true },
          { name: '🛡️ Auto-Moderation', value: '✅ Enabled', inline: true },
          { name: '👥 Role Progression', value: `${newRole ? 'New: ' + newRole.name + '\\n' : ''}${memberRole ? 'Member: ' + memberRole.name + '\\n' : ''}${shadowRole ? 'Shadow: ' + shadowRole.name : 'Not set'}`, inline: false }
        )
        .setFooter({ text: 'Leveling: Level 1 → Level 10 → Level 25' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
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
    name: 'level',
    description: 'Check your level or another user\'s level',
    options: [
      {
        name: 'user',
        type: 6,
        description: 'The user to check level for',
        required: false
      }
    ],
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const userData = LevelingSystem.getUserData(user.id, interaction.guild.id);

      const currentLevel = userData.level;
      const currentXP = userData.xp;
      const xpForNextLevel = LevelingSystem.calculateXPRequired(currentLevel + 1);
      const xpNeeded = xpForNextLevel - currentXP;
      const progress = Math.floor((currentXP / xpForNextLevel) * 100);

      const embed = new EmbedBuilder()
        .setTitle(`📊 Level Info - ${user.username}`)
        .setColor(0x3498DB)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: 'Level', value: `${currentLevel}`, inline: true },
          { name: 'XP', value: `${currentXP}`, inline: true },
          { name: 'XP to Next Level', value: `${Math.ceil(xpNeeded)}`, inline: true },
          { name: 'Progress', value: `${progress}% to Level ${currentLevel + 1}`, inline: false }
        )
        .setFooter({ text: 'Keep chatting to level up!' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    name: 'leaderboard',
    description: 'Show the server level leaderboard',
    async execute(interaction) {
      const leaderboard = LevelingSystem.getLeaderboard(interaction.guild.id, 10);
      
      if (leaderboard.length === 0) {
        return interaction.reply({ content: 'No level data available yet. Start chatting!', ephemeral: true });
      }

      const leaderboardText = await Promise.all(leaderboard.map(async (user, index) => {
        const member = await interaction.guild.members.fetch(user.userId).catch(() => null);
        const username = member ? member.user.username : 'Unknown User';
        const medals = ['🥇', '🥈', '🥉'];
        const medal = index < 3 ? medals[index] : `**${index + 1}.**`;
        return `${medal} **${username}** - Level ${user.level} (${user.xp} XP)`;
      }));

      const embed = new EmbedBuilder()
        .setTitle('🏆 Server Leaderboard')
        .setColor(0xF1C40F)
        .setDescription(leaderboardText.join('\n'))
        .setFooter({ text: `Top ${leaderboard.length} members by XP` })
        .setTimestamp();

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
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({ content: '❌ You need Moderate Members permission.', ephemeral: true });
      }

      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const member = interaction.guild.members.cache.get(user.id);

      if (!member) {
        return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
      }

      const config = getServerConfig(interaction.guild.id);
      const userId = user.id;
      const guildId = interaction.guild.id;

      if (!serverConfigs[guildId].warnings[userId]) {
        serverConfigs[guildId].warnings[userId] = 0;
      }

      serverConfigs[guildId].warnings[userId]++;
      const strikes = serverConfigs[guildId].warnings[userId];

      await saveConfig();

      const logEmbed = new EmbedBuilder()
        .setTitle('⚠️ User Warned')
        .setColor(0xFFA500)
        .addFields(
          { name: '👤 User', value: `${user.tag} (${user.id})`, inline: true },
          { name: '🛡️ Moderator', value: `${interaction.user.tag}`, inline: true },
          { name: '📝 Reason', value: reason, inline: true },
          { name: '⚠️ Strikes', value: `${strikes}/${config.automod.strikeLimit}`, inline: true }
        )
        .setTimestamp();

      await sendModLog(interaction.guild, logEmbed);

      try {
        const userEmbed = new EmbedBuilder()
          .setTitle('⚠️ You have been warned')
          .setColor(0xFFA500)
          .setDescription(`You have been warned in **${interaction.guild.name}**`)
          .addFields(
            { name: 'Reason', value: reason, inline: true },
            { name: 'Moderator', value: interaction.user.tag, inline: true },
            { name: 'Strikes', value: `${strikes}/${config.automod.strikeLimit}`, inline: true }
          )
          .setFooter({ text: 'Please follow the server rules' })
          .setTimestamp();
        
        await user.send({ embeds: [userEmbed] });
      } catch (error) {
        // Can't DM user
      }

      const replyEmbed = new EmbedBuilder()
        .setTitle('✅ User Warned')
        .setColor(0x00FF00)
        .setDescription(`${user.tag} has been warned.`)
        .addFields(
          { name: 'Reason', value: reason, inline: true },
          { name: 'Strikes', value: `${strikes}/${config.automod.strikeLimit}`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [replyEmbed] });
    }
  }
  // Add other commands as needed...
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

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    bot: client?.user ? 'connected' : 'disconnected'
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

**Automated Features:**
• Leveling System - Earn XP by chatting!
• Role Progression - Level up to get new roles
• Music System - Play songs in voice channels
• Auto-Moderation - Keeps the server safe

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
        welcomeMessage = config.welcomeMessage
          .replace(/{user}/g, member.user.toString())
          .replace(/{server}/g, member.guild.name)
          .replace(/{count}/g, memberCount)
          .replace(/{username}/g, member.user.username)
          .replace(/{tag}/g, member.user.tag);
      } else {
        welcomeMessage = `🎉 **Welcome to ${member.guild.name}, ${member.user}!** 🎉\n\nWe're excited to have you with us! You are our **#${memberCount}** member!\n\n**Automated Features:**\n• Level up by chatting (Level 1-25)\n• Earn roles as you progress\n• Play music in voice channels\n\nWelcome to the community! 🚀`;
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

// Auto-join voice channel when you join
client.on('voiceStateUpdate', async (oldState, newState) => {
  const yourUserId = process.env.YOUR_USER_ID || 'YOUR_USER_ID_HERE';

  if (newState.member.id === yourUserId) {
    const config = getServerConfig(newState.guild.id);

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

  await deployCommands();

  client.user.setActivity({
    name: `${c.guilds.cache.size} servers | /setup-automated`,
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

// Button interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const config = getServerConfig(interaction.guild.id);

  if (interaction.customId === 'agree_rules') {
    try {
      await interaction.reply({ 
        content: '✅ Thank you for agreeing to the server rules! Enjoy your stay!', 
        ephemeral: true 
      });
    } catch (error) {
      console.error('Error handling rules agreement:', error);
    }
  }

  if (interaction.customId === 'start_verification') {
    if (!config.verification.enabled) return;

    try {
      const role = interaction.guild.roles.cache.get(config.verification.role);
      if (role && interaction.member) {
        await interaction.member.roles.add(role);
        await interaction.reply({ 
          content: '✅ Verification successful! You now have access to the server.', 
          ephemeral: true 
        });
      }
    } catch (error) {
      await interaction.reply({ 
        content: '❌ Verification failed. Please contact an administrator.', 
        ephemeral: true 
      });
    }
  }
});

// Message-based commands and auto-mod
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Run automod checks
  await handleAutoMod(message);

  // Handle leveling system
  if (message.guild && !message.author.bot) {
    const config = getServerConfig(message.guild.id);
    if (config.leveling?.enabled) {
      try {
        const xpToAdd = config.leveling.xpPerMessage || 15;
        const result = await LevelingSystem.addXP(message.author.id, message.guild.id, xpToAdd);
        
        if (result.leveledUp) {
          await LevelingSystem.handleLevelUp(message.member, result.newLevel, config);
          
          try {
            const dmEmbed = new EmbedBuilder()
              .setTitle('🎉 Level Up!')
              .setColor(0x9B59B6)
              .setDescription(`Congratulations! You've reached level **${result.newLevel}** in **${message.guild.name}**!`)
              .addFields(
                { name: 'Total XP', value: `${result.xp}`, inline: true },
                { name: 'Next Level', value: `Level ${result.newLevel + 1}`, inline: true }
              )
              .setTimestamp();
            
            await message.author.send({ embeds: [dmEmbed] });
          } catch (dmError) {
            // Can't DM user, that's okay
          }
        }
      } catch (error) {
        console.error('Error in leveling system:', error);
      }
    }
  }

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