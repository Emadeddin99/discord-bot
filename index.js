// Load environment variables FIRST
require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Collection, PermissionsBitField, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

// User warnings storage
const userWarnings = new Map();

// Simple Banned Words Lists
const bannedWords = {
  english: [
    'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'cunt', 'whore', 'slut',
    'bastard', 'motherfucker', 'bullshit', 'cock', 'dickhead', 'fag', 'faggot',
    'retard', 'nigger', 'nigga', 'chink', 'spic', 'kike', 'cocksucker'
  ],
  arabic: [
    'kos', 'kos omak', 'sharmouta', 'ahbal', 'ibn el sharmouta', 'kes ekhtak',
    'ya ibn el', 'ya bet el', 'ya kalb', 'ya harami', 'kesok', 'sharmoot',
    'sharmoota', '7aram', '7arami', '3ars', 'ibn el kalb', 'ahbal', 'ghabi',
    '7mar', 'kelb', 'ayre', 'manyak', 'nik', 'nerd'
  ]
};

// Load configuration
async function loadConfig() {
  try {
    const data = await fs.readFile(configPath, 'utf8');
    const savedData = JSON.parse(data);
    serverConfigs = savedData.serverConfigs || {};
    
    if (savedData.userWarnings) {
      Object.keys(savedData.userWarnings).forEach(guildId => {
        userWarnings.set(guildId, savedData.userWarnings[guildId]);
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
      userWarnings: Object.fromEntries(userWarnings)
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
      logChannel: null,
      verificationChannel: null,
      verificationRole: null,
      modChannel: null
    };
  }
  return serverConfigs[guildId];
}

// Simple Auto-Mod System
class SimpleAutoMod {
  static checkMessage(content) {
    const lowerContent = content.toLowerCase();
    
    // Check English banned words
    for (const word of bannedWords.english) {
      if (lowerContent.includes(word)) {
        return { language: 'english', word: word };
      }
    }
    
    // Check Arabic banned words
    for (const word of bannedWords.arabic) {
      if (lowerContent.includes(word)) {
        return { language: 'arabic', word: word };
      }
    }
    
    return null;
  }

  static async handleViolation(message, violation) {
    try {
      const guildId = message.guild.id;
      const userId = message.author.id;
      
      // Delete the message
      try {
        await message.delete();
        console.log(`✅ Deleted inappropriate message from ${message.author.tag}`);
      } catch (error) {
        console.log(`❌ Could not delete message: ${error.message}`);
      }

      // Add warning
      const warningCount = this.addWarning(guildId, userId, `Used banned ${violation.language} word: ${violation.word}`);
      
      // Send warning message
      const warningMessage = `⚠️ **Warning ${warningCount}/6** - Please avoid using inappropriate language.\n**Violation:** ${violation.word} (${violation.language})\n**Next action:** ${7 - warningCount} more warnings will result in a timeout.`;
      
      try {
        const warningReply = await message.channel.send(warningMessage);
        // Auto-delete warning after 10 seconds
        setTimeout(async () => {
          try {
            await warningReply.delete();
          } catch (error) {
            // Message already deleted
          }
        }, 10000);
      } catch (error) {
        console.log('Could not send warning message');
      }

      // Send DM to user
      try {
        const dmEmbed = new EmbedBuilder()
          .setTitle('⚠️ Auto-Moderation Warning')
          .setColor(0xFFA500)
          .setDescription(`You received a warning in **${message.guild.name}**`)
          .addFields(
            { name: 'Warning Count', value: `${warningCount}/6`, inline: true },
            { name: 'Violation', value: `Used banned word: ${violation.word}`, inline: true },
            { name: 'Language', value: violation.language.toUpperCase(), inline: true },
            { name: 'Message', value: message.content.slice(0, 100) + '...', inline: false }
          )
          .setFooter({ text: 'Repeated violations will result in a timeout' })
          .setTimestamp();

        await message.author.send({ embeds: [dmEmbed] });
      } catch (dmError) {
        console.log(`Could not send DM to ${message.author.tag}`);
      }

      // Check if user should be timed out (6 warnings)
      if (warningCount >= 6) {
        await this.timeoutUser(message.member);
        this.clearWarnings(guildId, userId);
      }

      // Log to mod channel if set
      const config = getServerConfig(guildId);
      if (config.modChannel) {
        await this.logToModChannel(message, violation, warningCount);
      }

    } catch (error) {
      console.error('Error handling violation:', error);
    }
  }

  static addWarning(guildId, userId, reason) {
    if (!userWarnings.has(guildId)) {
      userWarnings.set(guildId, {});
    }
    const guildWarnings = userWarnings.get(guildId);
    
    if (!guildWarnings[userId]) {
      guildWarnings[userId] = [];
    }
    
    guildWarnings[userId].push({
      reason: reason,
      timestamp: Date.now()
    });
    
    saveConfig();
    return guildWarnings[userId].length;
  }

  static getWarnings(guildId, userId) {
    if (!userWarnings.has(guildId)) return [];
    const guildWarnings = userWarnings.get(guildId);
    return guildWarnings[userId] || [];
  }

  static clearWarnings(guildId, userId) {
    if (userWarnings.has(guildId)) {
      const guildWarnings = userWarnings.get(guildId);
      if (guildWarnings[userId]) {
        delete guildWarnings[userId];
        saveConfig();
        return true;
      }
    }
    return false;
  }

  static async timeoutUser(member) {
    try {
      // Timeout for 3 days
      const timeoutDuration = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds
      
      await member.timeout(timeoutDuration, 'Reached 6 auto-mod warnings');
      
      const timeoutMessage = `⏰ **${member.user.tag}** has been timed out for 3 days for reaching 6 warnings.`;
      await member.guild.systemChannel?.send(timeoutMessage).catch(() => {});
      
      console.log(`⏰ Timed out ${member.user.tag} for 3 days`);
      
    } catch (error) {
      console.error('Error timing out user:', error);
    }
  }

  static async logToModChannel(message, violation, warningCount) {
    try {
      const config = getServerConfig(message.guild.id);
      const modChannel = message.guild.channels.cache.get(config.modChannel);
      
      if (modChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('🛡️ Auto-Moderation Action')
          .setColor(0xFF0000)
          .setDescription(`Message from ${message.author} was flagged`)
          .addFields(
            { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
            { name: 'Channel', value: `${message.channel}`, inline: true },
            { name: 'Violation', value: `Banned ${violation.language} word: ${violation.word}`, inline: true },
            { name: 'Warning Count', value: `${warningCount}/6`, inline: true },
            { name: 'Message Content', value: message.content.slice(0, 1024), inline: false }
          )
          .setTimestamp()
          .setFooter({ text: 'Auto-Moderation System' });

        await modChannel.send({ embeds: [logEmbed] });
      }
    } catch (error) {
      console.error('Error logging to mod channel:', error);
    }
  }
}

// Command Definitions
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
          { name: '🛡️ Moderation', value: '`/warn`, `/warnings`, `/clearwarnings`, `/clear`, `/slowmode`, `/timeout`', inline: false },
          { name: '⚙️ Admin', value: '`/setup-welcome`, `/setwelcome`, `/setgoodbye`, `/setup-verification`, `/setmodchannel`', inline: false }
        )
        .setFooter({ text: 'Auto-moderation is always active for English and Arabic banned words' });

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

      const warnings = SimpleAutoMod.getWarnings(interaction.guild.id, user.id);

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
          { name: '⚠️ Warnings', value: `${warnings.length}/6`, inline: true },
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

  // 🛡️ Moderation Commands
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

      const warningCount = SimpleAutoMod.addWarning(interaction.guild.id, user.id, reason);

      const embed = new EmbedBuilder()
        .setTitle('⚠️ User Warned')
        .setColor(0xFFA500)
        .addFields(
          { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
          { name: 'Warned By', value: interaction.user.tag, inline: true },
          { name: 'Reason', value: reason, inline: false },
          { name: 'Total Warnings', value: `${warningCount}/6`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Check if user should be timed out (6 warnings)
      if (warningCount >= 6) {
        const member = interaction.guild.members.cache.get(user.id);
        if (member) {
          await SimpleAutoMod.timeoutUser(member);
          SimpleAutoMod.clearWarnings(interaction.guild.id, user.id);
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
      const warnings = SimpleAutoMod.getWarnings(interaction.guild.id, user.id);

      const embed = new EmbedBuilder()
        .setTitle(`⚠️ Warnings for ${user.tag}`)
        .setColor(0xFFA500)
        .addFields(
          { name: 'Total Warnings', value: `${warnings.length}/6`, inline: true }
        );

      if (warnings.length > 0) {
        warnings.slice(0, 10).forEach((warning, index) => {
          embed.addFields({
            name: `Warning ${index + 1}`,
            value: `**Reason:** ${warning.reason}\n**When:** <t:${Math.floor(warning.timestamp / 1000)}:R>`,
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
      const cleared = SimpleAutoMod.clearWarnings(interaction.guild.id, user.id);

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
  {
    name: 'timeout',
    description: 'Timeout a user',
    options: [
      { name: 'user', type: 6, description: 'The user to timeout', required: true },
      { name: 'duration', type: 4, description: 'Duration in minutes', required: true },
      { name: 'reason', type: 3, description: 'Reason for timeout', required: false }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({ content: '❌ You need moderation permissions.', flags: 64 });
      }

      const user = interaction.options.getUser('user');
      const duration = interaction.options.getInteger('duration');
      const reason = interaction.options.getString('reason') || 'No reason provided';

      try {
        const member = interaction.guild.members.cache.get(user.id);
        if (!member) {
          return interaction.reply({ content: '❌ User not found in this server.', flags: 64 });
        }

        const timeoutDuration = duration * 60 * 1000; // Convert to milliseconds
        await member.timeout(timeoutDuration, reason);

        const embed = new EmbedBuilder()
          .setTitle('⏰ User Timed Out')
          .setColor(0xFFA500)
          .addFields(
            { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
            { name: 'Duration', value: `${duration} minutes`, inline: true },
            { name: 'Reason', value: reason, inline: false },
            { name: 'Moderator', value: interaction.user.tag, inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

      } catch (error) {
        console.error('Error timing out user:', error);
        await interaction.reply({ content: '❌ Failed to timeout user.', flags: 64 });
      }
    }
  },

  // ⚙️ Admin Commands
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
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', flags: 64 });
      }

      const welcomeChannel = interaction.options.getChannel('welcome_channel');
      const goodbyeChannel = interaction.options.getChannel('goodbye_channel');
      const modChannel = interaction.options.getChannel('mod_channel');

      const config = getServerConfig(interaction.guild.id);
      
      let setupResults = [];

      if (welcomeChannel) {
        config.welcomeChannel = welcomeChannel.id;
        setupResults.push('✅ Welcome channel set');
      }

      if (goodbyeChannel) {
        config.goodbyeChannel = goodbyeChannel.id;
        setupResults.push('✅ Goodbye channel set');
      }

      if (modChannel) {
        config.modChannel = modChannel.id;
        setupResults.push('✅ Mod channel set');
      }

      await saveConfig();

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Setup Complete')
        .setColor(0x00FF00)
        .setDescription('The following features have been configured:')
        .addFields(
          { name: 'Setup Results', value: setupResults.join('\n') || 'No features configured', inline: false }
        )
        .setFooter({ text: 'Auto-moderation is always active for English and Arabic banned words' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
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
    name: 'setmodchannel',
    description: 'Set the moderation log channel',
    options: [
      {
        name: 'channel', type: 7, description: 'The channel to send moderation logs to', required: true, channel_types: [0]
      }
    ],
    async execute(interaction) {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions.', flags: 64 });
      }

      const channel = interaction.options.getChannel('channel');

      const config = getServerConfig(interaction.guild.id);
      config.modChannel = channel.id;

      await saveConfig();

      const embed = new EmbedBuilder()
        .setTitle('✅ Mod Channel Set')
        .setColor(0x00FF00)
        .setDescription(`Moderation logs will be sent to ${channel}`)
        .addFields(
          { name: 'Channel', value: `${channel}`, inline: true }
        )
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
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    message: 'Discord Bot is running!',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    guilds: client?.guilds?.cache?.size || 0
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

**Server Features:**
• Auto-moderation for English & Arabic
• Welcome/Goodbye messages
• Moderation tools
• Easy to use commands

**Important Rules:**
• No inappropriate language (English or Arabic)
• Be respectful to other members
• Follow Discord's Terms of Service

Use \`/help\` to see all available commands!

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
        welcomeMessage = `🎉 **Welcome to ${member.guild.name}, ${member.user}!** 🎉\n\nWe're excited to have you with us! You are our **#${memberCount}** member!\n\nPlease read the rules and enjoy your stay! 🚀`;
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

// Message content handler for simple auto-moderation
client.on('messageCreate', async (message) => {
  // Ignore bot messages and DMs
  if (message.author.bot || !message.guild) return;

  // Simple auto-moderation check
  const violation = SimpleAutoMod.checkMessage(message.content);
  if (violation) {
    await SimpleAutoMod.handleViolation(message, violation);
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
      .setDescription(`**Slash Commands:**\nUse \`/\` followed by the command name\n\n**Auto-Moderation:**\n• Automatically detects banned words in English & Arabic\n• 6 warnings = 3 day timeout\n• Warnings reset after timeout`)
      .setFooter({ text: 'Use /help for full command list!' });

    await message.reply({ embeds: [embed] });
  }
});

// Event Handlers
client.once('ready', async (c) => {
  console.log(`✅ Bot is ready! Logged in as ${c.user.tag}`);
  const serverCount = c.guilds.cache.size;
  console.log(`📊 Serving ${serverCount} server(s)`);
  console.log(`🔄 Loaded ${client.commands.size} commands`);
  console.log(`🌐 Health check server running on port ${PORT}`);
  console.log(`🛡️ Auto-moderation active for English & Arabic banned words`);

  // Set activity
  client.user.setActivity({
    name: `${serverCount} servers | /help`,
    type: ActivityType.Watching
  });

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
  server.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🔄 Shutting down bot gracefully...');
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