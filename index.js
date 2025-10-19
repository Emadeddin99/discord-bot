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

// Performance monitoring
class PerformanceMonitor {
  constructor() {
    this.stats = {
      commandsExecuted: 0,
      messagesProcessed: 0,
      voiceConnections: 0,
      memoryUsage: [],
      responseTimes: [],
      errors: 0
    };
    this.startTime = Date.now();
  }

  recordCommand() {
    this.stats.commandsExecuted++;
  }

  recordMessage() {
    this.stats.messagesProcessed++;
  }

  recordError() {
    this.stats.errors++;
  }

  recordResponseTime(time) {
    this.stats.responseTimes.push(time);
    // Keep only last 100 measurements
    if (this.stats.responseTimes.length > 100) {
      this.stats.responseTimes.shift();
    }
  }

  updateVoiceConnections(count) {
    this.stats.voiceConnections = count;
  }

  getMemoryUsage() {
    const usage = process.memoryUsage();
    this.stats.memoryUsage.push(usage);
    if (this.stats.memoryUsage.length > 50) {
      this.stats.memoryUsage.shift();
    }
    return usage;
  }

  getPerformanceStats() {
    const avgResponseTime = this.stats.responseTimes.length > 0 
      ? this.stats.responseTimes.reduce((a, b) => a + b, 0) / this.stats.responseTimes.length 
      : 0;

    const memoryTrend = this.stats.memoryUsage.length > 1 
      ? this.stats.memoryUsage[this.stats.memoryUsage.length - 1].heapUsed - this.stats.memoryUsage[0].heapUsed 
      : 0;

    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      commandsExecuted: this.stats.commandsExecuted,
      messagesProcessed: this.stats.messagesProcessed,
      voiceConnections: this.stats.voiceConnections,
      errors: this.stats.errors,
      avgResponseTime: Math.round(avgResponseTime),
      memoryTrend: Math.round(memoryTrend / 1024 / 1024),
      ...this.getMemoryUsage()
    };
  }
}

const monitor = new PerformanceMonitor();

// Optimized Discord client with only necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  // Performance optimizations
  restTimeOffset: 0,
  partials: [],
  failIfNotExists: false,
  presence: {
    status: 'online',
    activities: [{
      name: 'Starting up...',
      type: ActivityType.Watching
    }]
  }
});

// Memory-efficient configuration
class ConfigManager {
  constructor() {
    this.configPath = path.join(__dirname, 'config.json');
    this.serverConfigs = new Map();
    this.saveQueue = new Map();
    this.saveTimeout = null;
  }

  async load() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      const configs = JSON.parse(data);
      Object.entries(configs).forEach(([guildId, config]) => {
        this.serverConfigs.set(guildId, config);
      });
      console.log('✅ Configuration loaded successfully');
    } catch (error) {
      console.log('⚠️ No existing configuration found, starting fresh');
    }
  }

  get(guildId) {
    if (!this.serverConfigs.has(guildId)) {
      this.serverConfigs.set(guildId, this.getDefaultConfig());
    }
    return this.serverConfigs.get(guildId);
  }

  set(guildId, config) {
    this.serverConfigs.set(guildId, config);
    this.queueSave(guildId);
  }

  queueSave(guildId) {
    this.saveQueue.set(guildId, true);
    
    if (!this.saveTimeout) {
      this.saveTimeout = setTimeout(() => this.flushSaves(), 5000); // Batch saves every 5 seconds
    }
  }

  async flushSaves() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    if (this.saveQueue.size > 0) {
      try {
        const configObj = Object.fromEntries(this.serverConfigs);
        await fs.writeFile(this.configPath, JSON.stringify(configObj, null, 2));
        console.log(`💾 Configuration saved (${this.saveQueue.size} servers)`);
        this.saveQueue.clear();
      } catch (error) {
        console.error('❌ Failed to save configuration:', error);
      }
    }
  }

  getDefaultConfig() {
    return {
      welcomeChannel: null,
      goodbyeChannel: null,
      autoRole: null,
      enableWelcome: true,
      enableGoodbye: true,
      enableDMs: true,
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
}

const configManager = new ConfigManager();

// Optimized data structures
class EfficientCache {
  constructor(cleanupInterval = 300000) { // 5 minutes
    this.cache = new Map();
    this.timestamps = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupInterval);
  }

  set(key, value, ttl = 3600000) { // 1 hour default
    this.cache.set(key, value);
    this.timestamps.set(key, Date.now() + ttl);
  }

  get(key) {
    const timestamp = this.timestamps.get(key);
    if (timestamp && Date.now() > timestamp) {
      this.delete(key);
      return null;
    }
    return this.cache.get(key);
  }

  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, expiry] of this.timestamps) {
      if (now > expiry) {
        this.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
    this.timestamps.clear();
  }
}

// Use efficient caches
const messageCounts = new EfficientCache(60000); // Cleanup every minute
const userCooldowns = new EfficientCache(300000); // Cleanup every 5 minutes
const voiceConnections = new Map();
const audioPlayers = new Map();
const musicQueues = new Map();

// Optimized banned words using Sets for faster lookup
const GLOBAL_BANNED_WORDS = {
  english: new Set([
    'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'whore',
    'nigger', 'nigga', 'chink', 'spic', 'kike', 'fag', 'faggot',
    'kill yourself', 'kys', 'die', 'retard', 'mongoloid'
  ]),
  arabic: new Set([
    'كس', 'طيز', 'زبر', 'شرموط', 'عاهر', 'قحبة', 'دعارة',
    'كسم', 'كسمك', 'كسمكم', 'ابن المتناكة', 'ابن الكلب',
    'حمار', 'كلب', 'غبي', 'عبيط', 'هطل', 'يلعن'
  ])
};

// Optimized Leveling System with caching
class OptimizedLevelingSystem {
  static getUserKey(userId, guildId) {
    return `user_${userId}_${guildId}`;
  }

  static getUserData(userId, guildId) {
    const key = this.getUserKey(userId, guildId);
    const cached = userCooldowns.get(key);
    if (cached) return cached;

    const data = quickdb.get(key) || { xp: 0, level: 1, lastMessage: 0 };
    userCooldowns.set(key, data, 300000); // Cache for 5 minutes
    return data;
  }

  static saveUserData(userId, guildId, data) {
    const key = this.getUserKey(userId, guildId);
    quickdb.set(key, data);
    userCooldowns.set(key, data, 300000); // Update cache
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
    const config = configManager.get(guildId);
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
      // Don't await this to avoid blocking
      this.handleLevelUp(userId, guildId, newLevel, config).catch(console.error);
    }

    this.saveUserData(userId, guildId, userData);
    return { leveledUp, newLevel, xp: userData.xp };
  }

  static async handleLevelUp(userId, guildId, newLevel, config) {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return;

      const newRoleId = config.leveling.rewards.new;
      const memberRoleId = config.leveling.rewards.member;
      const shadowRoleId = config.leveling.rewards.shadow;

      const memberThreshold = config.leveling.thresholds.member;
      const shadowThreshold = config.leveling.thresholds.shadow;

      let roleToAdd = null;
      let roleToRemove = null;

      if (newLevel >= shadowThreshold && shadowRoleId) {
        roleToAdd = shadowRoleId;
        roleToRemove = memberRoleId;
      } else if (newLevel >= memberThreshold && memberRoleId) {
        roleToAdd = memberRoleId;
        roleToRemove = newRoleId;
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

    } catch (error) {
      console.error('Error handling level up:', error);
    }
  }
}

// Optimized Music System
class OptimizedMusicSystem {
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

      // Use lower quality for better performance
      const stream = ytdl(song.url, {
        filter: 'audioonly',
        quality: 'lowestaudio',
        highWaterMark: 1 << 22, // Reduced buffer size
        dlChunkSize: 0 // Let ytdl choose optimal chunk size
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
      }
    }
  }

  static async addToQueue(guildId, song) {
    const queue = this.getQueue(guildId);
    
    // Validate URL first
    if (!ytdl.validateURL(song.url)) {
      throw new Error('Invalid YouTube URL');
    }

    // Get info in background without blocking
    this.getSongInfo(song).then(info => {
      song.title = info.title;
      song.duration = info.duration;
      song.thumbnail = info.thumbnail;
    }).catch(() => {
      song.title = 'Unknown Title';
      song.duration = 0;
    });
    
    queue.songs.push(song);
    const position = queue.songs.length;

    if (!queue.isPlaying) {
      this.playSong(guildId);
    }

    return position;
  }

  static async getSongInfo(song) {
    const info = await ytdl.getInfo(song.url);
    return {
      title: info.videoDetails.title,
      duration: info.videoDetails.lengthSeconds,
      thumbnail: info.videoDetails.thumbnails[0]?.url
    };
  }
}

// Optimized auto-moderation with early returns
class OptimizedAutoMod {
  static containsBannedWords(text, config) {
    const lowerText = text.toLowerCase();
    
    // Check global banned words first (fast Set lookup)
    for (const word of GLOBAL_BANNED_WORDS.english) {
      if (lowerText.includes(word)) {
        return { found: true, word };
      }
    }
    for (const word of GLOBAL_BANNED_WORDS.arabic) {
      if (lowerText.includes(word)) {
        return { found: true, word };
      }
    }
    
    // Check server-specific banned words
    for (const word of config.automod.bannedWords) {
      if (word && lowerText.includes(word.toLowerCase())) {
        return { found: true, word };
      }
    }
    
    return { found: false };
  }

  static isSpam(userId, guildId) {
    const key = `${guildId}-${userId}`;
    const now = Date.now();
    
    const userMessages = messageCounts.get(key) || [];
    userMessages.push(now);
    
    // Keep only messages from last 5 seconds
    const recentMessages = userMessages.filter(time => now - time < 5000);
    messageCounts.set(key, recentMessages, 10000); // Cache for 10 seconds
    
    return recentMessages.length > 5;
  }

  static async processMessage(message) {
    if (!message.guild || message.author.bot) return;
    
    const config = configManager.get(message.guild.id);
    if (!config.automod.enabled) return;

    const content = message.content;
    const violations = [];

    // Early return checks from most common to least common
    if (config.automod.antiSpam && this.isSpam(message.author.id, message.guild.id)) {
      violations.push('Spam detection');
    }

    const bannedWordCheck = this.containsBannedWords(content, config);
    if (bannedWordCheck.found) {
      violations.push(`Banned word: "${bannedWordCheck.word}"`);
    }

    if (config.automod.antiMention && (content.match(/@/g) || []).length > config.automod.maxMentions) {
      violations.push(`Excessive mentions`);
    }

    if (config.automod.antiInvites && /(discord\.gg\/|discordapp\.com\/invite\/)/i.test(content)) {
      violations.push('Discord invite links');
    }

    if (config.automod.antiCaps && content.length >= 10) {
      const capsCount = (content.match(/[A-Z]/g) || []).length;
      if ((capsCount / content.length) * 100 > config.automod.capsPercentage) {
        violations.push('Excessive capital letters');
      }
    }

    if (violations.length > 0) {
      await this.handleViolation(message, violations.join(', '), config);
    }
  }

  static async handleViolation(message, reason, config) {
    try {
      const userId = message.author.id;
      const guildId = message.guild.id;
      const config = configManager.get(guildId);
      
      config.warnings[userId] = (config.warnings[userId] || 0) + 1;
      const strikes = config.warnings[userId];

      // Delete message without waiting
      message.delete().catch(() => {});

      // Send mod log in background
      this.sendModLog(message, reason, strikes, config).catch(console.error);

      if (strikes >= config.automod.strikeLimit) {
        await this.executeAction(message.member, config);
        config.warnings[userId] = 0;
      }

      configManager.set(guildId, config);

    } catch (error) {
      console.error('Error in handleViolation:', error);
      monitor.recordError();
    }
  }

  static async sendModLog(message, reason, strikes, config) {
    if (!config.modLogChannel) return;

    const logChannel = message.guild.channels.cache.get(config.modLogChannel);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Auto-Moderation Action')
      .setColor(0xFF6B6B)
      .addFields(
        { name: '👤 User', value: `${message.author.tag}`, inline: true },
        { name: '🚫 Reason', value: reason, inline: true },
        { name: '⚠️ Strikes', value: `${strikes}/${config.automod.strikeLimit}`, inline: true }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  }
}

// Optimized command handler
client.commands = new Collection();

const commands = [
  {
    name: 'ping',
    description: "Check the bot's latency",
    async execute(interaction) {
      const startTime = Date.now();
      await interaction.deferReply();
      
      const stats = monitor.getPerformanceStats();
      const embed = new EmbedBuilder()
        .setTitle('🏓 Pong!')
        .setColor(0x00FF00)
        .addFields(
          { name: '🤖 Bot Latency', value: `${Date.now() - startTime}ms`, inline: true },
          { name: '📡 API Latency', value: `${Math.round(client.ws.ping)}ms`, inline: true },
          { name: '💾 Memory', value: `${Math.round(stats.heapUsed / 1024 / 1024)}MB`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      monitor.recordCommand();
      monitor.recordResponseTime(Date.now() - startTime);
    }
  },
  {
    name: 'stats',
    description: 'Get bot performance statistics',
    async execute(interaction) {
      const stats = monitor.getPerformanceStats();
      
      const embed = new EmbedBuilder()
        .setTitle('📊 Bot Performance Stats')
        .setColor(0x3498DB)
        .addFields(
          { name: '⏰ Uptime', value: `${Math.floor(stats.uptime / 60)}m`, inline: true },
          { name: '⚡ Commands', value: stats.commandsExecuted.toString(), inline: true },
          { name: '💬 Messages', value: stats.messagesProcessed.toString(), inline: true },
          { name: '🔊 Voice Connections', value: stats.voiceConnections.toString(), inline: true },
          { name: '🚨 Errors', value: stats.errors.toString(), inline: true },
          { name: '📈 Avg Response', value: `${stats.avgResponseTime}ms`, inline: true },
          { name: '💾 Memory Usage', value: `${Math.round(stats.heapUsed / 1024 / 1024)}MB`, inline: true },
          { name: '📊 Memory Trend', value: `${stats.memoryTrend > 0 ? '+' : ''}${stats.memoryTrend}MB`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      monitor.recordCommand();
    }
  }
  // Add other optimized commands...
];

// Register commands
commands.forEach(cmd => {
  client.commands.set(cmd.name, cmd);
});

// Enhanced health check with performance metrics
app.get('/', (req, res) => {
  const stats = monitor.getPerformanceStats();
  
  res.status(200).json({
    status: 'online',
    timestamp: new Date().toISOString(),
    performance: {
      uptime: stats.uptime,
      commandsExecuted: stats.commandsExecuted,
      messagesProcessed: stats.messagesProcessed,
      voiceConnections: stats.voiceConnections,
      errors: stats.errors,
      avgResponseTime: stats.avgResponseTime,
      memory: {
        used: `${Math.round(stats.heapUsed / 1024 / 1024)}MB`,
        trend: `${stats.memoryTrend}MB`
      }
    },
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      guilds: client.guilds?.cache?.size || 0
    }
  });
});

app.get('/health', (req, res) => {
  const stats = monitor.getPerformanceStats();
  
  // Health check criteria
  const isHealthy = stats.errors < 100 && stats.uptime > 60;
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: stats.uptime,
    errors: stats.errors,
    memory: Math.round(stats.heapUsed / 1024 / 1024)
  });
});

// Memory usage monitoring
setInterval(() => {
  monitor.getMemoryUsage();
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  // Log memory usage every 5 minutes
  if (process.env.NODE_ENV === 'development') {
    const stats = monitor.getPerformanceStats();
    console.log(`🧠 Memory: ${Math.round(stats.heapUsed / 1024 / 1024)}MB | Connections: ${stats.voiceConnections}`);
  }
}, 300000);

// Optimized event handlers
client.once('ready', async (c) => {
  await configManager.load();
  
  console.log(`✅ Bot is ready! Logged in as ${c.user.tag}`);
  console.log(`📊 Serving ${c.guilds.cache.size} server(s)`);
  console.log(`🔄 Loaded ${client.commands.size} commands`);
  
  // Update activity with performance info
  setInterval(() => {
    const stats = monitor.getPerformanceStats();
    client.user.setActivity({
      name: `${c.guilds.cache.size} servers | ${Math.round(stats.heapUsed / 1024 / 1024)}MB`,
      type: ActivityType.Watching
    });
  }, 60000);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  const startTime = Date.now();
  
  try {
    await command.execute(interaction);
    monitor.recordResponseTime(Date.now() - startTime);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}:`, error);
    monitor.recordError();
    
    await interaction.reply({ 
      content: '❌ There was an error executing this command!', 
      ephemeral: true 
    }).catch(() => {});
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  monitor.recordMessage();

  // Process auto-mod in background
  OptimizedAutoMod.processMessage(message).catch(console.error);

  // Handle leveling system
  if (message.guild) {
    const config = configManager.get(message.guild.id);
    if (config.leveling?.enabled) {
      OptimizedLevelingSystem.addXP(message.author.id, message.guild.id, config.leveling.xpPerMessage)
        .catch(error => console.error('Leveling error:', error));
    }
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  monitor.updateVoiceConnections(voiceConnections.size);
});

// Graceful shutdown with cleanup
async function gracefulShutdown() {
  console.log('🔄 Shutting down bot gracefully...');
  
  // Save all pending config changes
  await configManager.flushSaves();
  
  // Clean up voice connections
  for (const [guildId] of voiceConnections) {
    const connection = voiceConnections.get(guildId);
    const player = audioPlayers.get(guildId);
    
    if (player) player.stop();
    if (connection) connection.destroy();
  }
  
  voiceConnections.clear();
  audioPlayers.clear();
  musicQueues.clear();
  
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start the bot
const server = app.listen(PORT, () => {
  console.log(`🫀 Health check server running on port ${PORT}`);
});

// Enable GC in production
if (process.env.NODE_ENV === 'production' && !global.gc) {
  console.log('🔧 Running in production mode - consider using --expose-gc flag');
}

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌ ERROR: DISCORD_BOT_TOKEN is not set!');
  process.exit(1);
}

client.login(token).catch(error => {
  console.error('❌ Failed to login:', error.message);
  process.exit(1);
});