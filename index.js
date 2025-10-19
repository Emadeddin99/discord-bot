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
      verificationRole: null,
      // Auto-mod settings - AUTO ENABLED BY DEFAULT
      autoModSettings: {
        enabled: true,  // AUTO-ENABLED
        deleteMessages: true,
        warnUsers: true,
        logActions: true,
        checkArabic: true,
        checkEnglish: true,
        maxWarnings: 3,
        muteDuration: 10
      }
    };
  }
  return serverConfigs[guildId];
}

// Enhanced Bilingual Text Monitoring System with Typo Detection
class BilingualAutoMod {
  // Comprehensive English banned words with common variations
  static englishBannedWords = [
    // Profanity - Base words
    'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'cunt', 'whore', 'slut',
    'bastard', 'motherfucker', 'bullshit', 'damn', 'hell', 'cock', 'dickhead',
    'fag', 'faggot', 'retard', 'nigger', 'nigga', 'chink', 'spic', 'kike', 'wetback',
    'cocksucker', 'douchebag', 'douche', 'scumbag', 'shithead', 'dipshit', 'shitface',
    'asswipe', 'asshat', 'arsehole', 'wanker', 'twat', 'bellend', 'prick', 'dildo',
    
    // Hate speech
    'kill all', 'death to', 'exterminate', 'genocide', 'gas the', 'holocaust',
    'white power', 'black power', 'hitler', 'nazi', 'kkk', 'racist', 'sexist',
    'homophobic', 'transphobic', 'islamophobic', 'anti semitic', 'anti-semitic',
    
    // Threats
    'i will kill', 'i will murder', 'i will hurt', 'i will beat', 'i will shoot',
    'kill you', 'murder you', 'hurt you', 'beat you', 'shoot you', 'stab you',
    'attack you', 'fight you', 'destroy you', 'eliminate you',
    
    // Self-harm
    'i want to die', 'i will kill myself', 'suicide', 'cut myself', 'end my life',
    'want to die', 'kill myself', 'commit suicide', 'end it all', 'self harm',
    'cutting', 'self injury', 'suicidal', 'overdose'
  ];

  // Comprehensive Arabic banned words with variations (transliterated)
  static arabicBannedWords = [
    // Profanity
    'kos', 'kos omak', 'sharmouta', 'ahbal', 'ibn el sharmouta', 'kes ekhtak',
    'ya ibn el', 'ya bet el', 'ya kalb', 'ya harami', 'ya wad', 'ya 3ars',
    'kosok', 'kosk', 'sharmoot', 'sharmoota', '7aram', '7arami', '3ars', '3ar',
    'ibn el kalb', 'bent el kalb', 'omak', 'abook', 'ahbal', 'ghabi', 'mahbol',
    'majnoon', 'magnoon', 'hayawan', '7mar', 'kelb', '2alb',
    
    // Religious insults
    'ya ibn el kalb', 'allah yakhodak', 'ya kafir', 'ya murtad', 'rasool el shaytan',
    'nabi el shaytan', 'religion el shaytan', 'deenak', 'allah', 'islam', 'muslim',
    'christian', 'yehudi', 'bouddha',
    
    // Threats
    'hatktlk', 'hamotak', 'ha2tlak', 'harag', 'haragek', 'moot', 'mawt', 'a2telak',
    'a2telk', 'hatk', 'hamot', 'harag', '7arag', '7aragek', 'darb', 'darab',
    'sa7ab', 'se7ab', 'ye7keek', 'ye7kiik',
    
    // Sexual content
    'ayre', 'manyak', 'mnayek', 'nerd', 'nrd', 'nrdy', 'manyake', 'manyak',
    'mounik', 'nik', 'nyk', 'sexy', 'sex', 'make love', 'sleep with',
    'sexual', 'intercourse', 'porn', 'porno'
  ];

  // Common character substitutions for typo detection
  static characterSubstitutions = {
    'a': ['4', '@', 'á', 'à', 'â', 'ä'],
    'b': ['8', '6', '13'],
    'c': ['(', '[', '<', '©'],
    'e': ['3', '&', 'é', 'è', 'ê', 'ë'],
    'g': ['9', '6'],
    'i': ['1', '!', '|', 'í', 'ì', 'î', 'ï'],
    'l': ['1', '|', '7'],
    'o': ['0', '()', 'ó', 'ò', 'ô', 'ö'],
    's': ['5', '$', 'z'],
    't': ['7', '+'],
    'z': ['2', 's'],
    '0': ['o'],
    '1': ['i', 'l'],
    '3': ['e'],
    '4': ['a'],
    '5': ['s'],
    '7': ['t', 'l'],
    '8': ['b'],
    '9': ['g']
  };

  // Arabic character ranges for detection
  static arabicRanges = [
    [0x0600, 0x06FF], // Arabic
    [0x0750, 0x077F], // Arabic Supplement
    [0x08A0, 0x08FF], // Arabic Extended-A
    [0xFB50, 0xFDFF], // Arabic Presentation Forms-A
    [0xFE70, 0xFEFF]  // Arabic Presentation Forms-B
  ];

  // Normalize text for better detection (handles leetspeak and common substitutions)
  static normalizeText(text) {
    let normalized = text.toLowerCase();
    
    // Replace common character substitutions
    Object.keys(this.characterSubstitutions).forEach(normalChar => {
      this.characterSubstitutions[normalChar].forEach(subChar => {
        const regex = new RegExp(subChar, 'gi');
        normalized = normalized.replace(regex, normalChar);
      });
    });
    
    // Remove repeated characters (e.g., "fuuuck" -> "fuck")
    normalized = normalized.replace(/(.)\1{2,}/g, '$1$1');
    
    // Remove extra spaces and special characters
    normalized = normalized.replace(/[^\w\s]/g, '');
    normalized = normalized.replace(/\s+/g, ' ');
    
    return normalized.trim();
  }

  // Generate typo variations for a word
  static generateTypoVariations(word) {
    const variations = new Set([word]);
    
    // Common typo patterns
    const typoPatterns = [
      // Double letters
      (w) => w.replace(/([a-z])\1/g, '$1'),
      // Missing vowels
      (w) => w.replace(/[aeiou]/g, ''),
      // Character swaps
      (w) => {
        if (w.length > 1) {
          const chars = w.split('');
          for (let i = 0; i < chars.length - 1; i++) {
            const swapped = [...chars];
            [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
            variations.add(swapped.join(''));
          }
        }
        return w;
      }
    ];
    
    typoPatterns.forEach(pattern => {
      variations.add(pattern(word));
    });
    
    return Array.from(variations);
  }

  // Check if text contains Arabic characters
  static containsArabic(text) {
    for (let char of text) {
      const code = char.charCodeAt(0);
      for (let [start, end] of this.arabicRanges) {
        if (code >= start && code <= end) {
          return true;
        }
      }
    }
    return false;
  }

  // Check for banned content in both languages with typo detection
  static checkMessage(content, guildId) {
    const config = getServerConfig(guildId);
    if (!config.autoModSettings.enabled) return null;

    const lowerContent = content.toLowerCase();
    const normalizedContent = this.normalizeText(content);
    
    const results = {
      violations: [],
      language: 'none',
      severity: 'low',
      originalWord: '',
      detectedVariation: ''
    };

    // Check English content if enabled
    if (config.autoModSettings.checkEnglish) {
      for (const baseWord of this.englishBannedWords) {
        // Check exact match
        if (lowerContent.includes(baseWord) || normalizedContent.includes(baseWord)) {
          results.violations.push({
            word: baseWord,
            language: 'english',
            type: this.getViolationType(baseWord),
            variation: 'exact'
          });
          continue;
        }

        // Check with typo variations
        const variations = this.generateTypoVariations(baseWord);
        for (const variation of variations) {
          if (variation !== baseWord && 
              (lowerContent.includes(variation) || normalizedContent.includes(variation))) {
            results.violations.push({
              word: baseWord,
              language: 'english',
              type: this.getViolationType(baseWord),
              variation: variation,
              isTypo: true
            });
            break;
          }
        }

        // Check with character substitutions (leetspeak)
        if (this.checkLeetspeak(lowerContent, baseWord)) {
          results.violations.push({
            word: baseWord,
            language: 'english',
            type: this.getViolationType(baseWord),
            variation: 'leetspeak',
            isTypo: true
          });
        }
      }
    }

    // Check Arabic content if enabled
    if (config.autoModSettings.checkArabic) {
      // Check for Arabic characters
      if (this.containsArabic(content)) {
        // Check transliterated Arabic banned words
        for (const baseWord of this.arabicBannedWords) {
          if (lowerContent.includes(baseWord) || normalizedContent.includes(baseWord)) {
            results.violations.push({
              word: baseWord,
              language: 'arabic',
              type: this.getViolationType(baseWord),
              variation: 'exact'
            });
            continue;
          }

          // Check Arabic variations
          const variations = this.generateTypoVariations(baseWord);
          for (const variation of variations) {
            if (variation !== baseWord && 
                (lowerContent.includes(variation) || normalizedContent.includes(variation))) {
              results.violations.push({
                word: baseWord,
                language: 'arabic',
                type: this.getViolationType(baseWord),
                variation: variation,
                isTypo: true
              });
              break;
            }
          }
        }

        // Additional Arabic content checks
        if (this.checkArabicSeverity(content)) {
          results.violations.push({
            word: 'arabic_content',
            language: 'arabic',
            type: 'inappropriate',
            variation: 'pattern'
          });
        }
      }
    }

    // Determine overall severity
    if (results.violations.length > 0) {
      results.severity = this.determineSeverity(results.violations);
      results.language = results.violations[0].language;
      
      // Store detection details
      const firstViolation = results.violations[0];
      results.originalWord = firstViolation.word;
      results.detectedVariation = firstViolation.variation;
      
      return results;
    }

    return null;
  }

  // Check for leetspeak variations
  static checkLeetspeak(content, word) {
    const leetPatterns = this.generateLeetPatterns(word);
    return leetPatterns.some(pattern => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(content);
    });
  }

  // Generate leetspeak patterns for a word
  static generateLeetPatterns(word) {
    const patterns = [];
    const chars = word.split('');
    
    // Generate pattern with common substitutions
    let pattern = '';
    chars.forEach(char => {
      if (this.characterSubstitutions[char]) {
        pattern += `[${char}${this.characterSubstitutions[char].join('')}]`;
      } else {
        pattern += char;
      }
    });
    patterns.push(pattern);
    
    // Additional common leetspeak patterns
    if (word.includes('a')) patterns.push(word.replace(/a/gi, '[a4@]'));
    if (word.includes('e')) patterns.push(word.replace(/e/gi, '[e3]'));
    if (word.includes('i')) patterns.push(word.replace(/i/gi, '[i1!]'));
    if (word.includes('o')) patterns.push(word.replace(/o/gi, '[o0]'));
    if (word.includes('s')) patterns.push(word.replace(/s/gi, '[s5$]'));
    if (word.includes('t')) patterns.push(word.replace(/t/gi, '[t7]'));
    
    return patterns;
  }

  // Determine violation type
  static getViolationType(word) {
    const profanity = [
      'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'cunt', 'whore', 'slut',
      'bastard', 'motherfucker', 'bullshit', 'damn', 'hell', 'cock', 'dickhead',
      'kos', 'sharmouta', 'ahbal', 'kes', '3ars', 'ayre', 'manyak'
    ];
    
    const hateSpeech = [
      'nigger', 'nigga', 'chink', 'spic', 'kike', 'wetback', 'fag', 'faggot', 'retard',
      'kill all', 'death to', 'exterminate', 'genocide', 'gas the', 'holocaust',
      'kafir', 'murtad'
    ];
    
    const threats = [
      'kill', 'murder', 'hurt', 'beat', 'shoot', 'hamotak', 'ha2tlak', 'harag',
      'moot', 'mawt', 'a2telak'
    ];

    const selfHarm = [
      'suicide', 'kill myself', 'cut myself', 'end my life', 'want to die'
    ];

    if (hateSpeech.some(h => word.includes(h))) return 'hate_speech';
    if (threats.some(t => word.includes(t))) return 'threat';
    if (selfHarm.some(s => word.includes(s))) return 'self_harm';
    if (profanity.some(p => word.includes(p))) return 'profanity';
    return 'inappropriate';
  }

  // Check Arabic content severity
  static checkArabicSeverity(content) {
    const severePatterns = [
      /كسمك/gi, /كس امك/gi, /شرموطة/gi, /احا/gi, /ابن/gi, /كلب/gi,
      /حرامي/gi, /هاتك/gi, /هاجر/gi, /نيك/gi, /انيج/gi, /قحبة/gi,
      /عاهر/gi, /زانية/gi, /دعارة/gi
    ];

    return severePatterns.some(pattern => pattern.test(content));
  }

  // Determine overall severity
  static determineSeverity(violations) {
    const hasHateSpeech = violations.some(v => v.type === 'hate_speech');
    const hasThreats = violations.some(v => v.type === 'threat');
    const hasSelfHarm = violations.some(v => v.type === 'self_harm');
    
    if (hasHateSpeech || hasThreats || hasSelfHarm) return 'high';
    if (violations.some(v => v.type === 'profanity')) return 'medium';
    return 'low';
  }

  // Get violation description in both languages
  static getViolationDescription(violations, language) {
    const types = violations.map(v => v.type);
    
    if (language === 'arabic') {
      if (types.includes('hate_speech')) return 'كلام كراهية';
      if (types.includes('threat')) return 'تهديدات';
      if (types.includes('self_harm')) return 'إيذاء النفس';
      if (types.includes('profanity')) return 'الفاظ نابية';
      return 'محتوى غير لائق';
    } else {
      if (types.includes('hate_speech')) return 'Hate speech';
      if (types.includes('threat')) return 'Threats';
      if (types.includes('self_harm')) return 'Self-harm content';
      if (types.includes('profanity')) return 'Profanity';
      return 'Inappropriate content';
    }
  }

  // Get typo detection message
  static getTypoDetectionMessage(violation, language) {
    if (!violation.isTypo) return '';
    
    if (language === 'arabic') {
      return ` (تم الكشف عن تغيير في الكتابة: ${violation.variation})`;
    } else {
      return ` (detected variation: ${violation.variation})`;
    }
  }
}

// Enhanced Auto-Moderation System with Bilingual Support
class AutoModSystem {
  static isEnabled(guildId) {
    const config = getServerConfig(guildId);
    return config.autoModSettings.enabled || false;
  }

  static async handleViolation(message, violationResult) {
    try {
      const config = getServerConfig(message.guild.id);
      
      // Debug logging
      console.log(`🛡️ Auto-mod processing violation:`, {
        user: message.author.tag,
        content: message.content,
        violations: violationResult.violations.length,
        severity: violationResult.severity
      });

      // Delete the message if enabled
      if (config.autoModSettings.deleteMessages) {
        try {
          await message.delete();
          console.log(`✅ Deleted message from ${message.author.tag}`);
        } catch (deleteError) {
          console.log(`❌ Could not delete message: ${deleteError.message}`);
        }
      }

      // Add warning to user if enabled
      if (config.autoModSettings.warnUsers) {
        this.addWarning(message.guild.id, message.author.id, 
          `Auto-mod violation: ${BilingualAutoMod.getViolationDescription(violationResult.violations, 'english')}`
        );

        // Send warning DM in appropriate language
        await this.sendWarningDM(message, violationResult);
      }

      // Log the action if enabled
      if (config.autoModSettings.logActions && config.logChannel) {
        await this.logViolation(message, violationResult);
      }

      console.log(`🛡️ Auto-mod action completed for ${message.author.tag}: ${violationResult.severity} severity`);

    } catch (error) {
      console.error('Error handling auto-mod violation:', error);
    }
  }

  static async sendWarningDM(message, violationResult) {
    try {
      const violationDesc = BilingualAutoMod.getViolationDescription(violationResult.violations, 'english');
      const arabicDesc = BilingualAutoMod.getViolationDescription(violationResult.violations, 'arabic');
      
      const typoMessage = BilingualAutoMod.getTypoDetectionMessage(violationResult.violations[0], 'english');
      const arabicTypoMessage = BilingualAutoMod.getTypoDetectionMessage(violationResult.violations[0], 'arabic');
      
      const warningDM = new EmbedBuilder()
        .setTitle('⚠️ Auto-Moderation Warning')
        .setColor(0xFFA500)
        .setDescription(`Your message in **${message.guild.name}** was flagged by our moderation system.`)
        .addFields(
          { name: 'Violation', value: violationDesc + typoMessage, inline: true },
          { name: 'Severity', value: violationResult.severity.toUpperCase(), inline: true },
          { name: 'Language', value: violationResult.language.toUpperCase(), inline: true },
          { name: 'Message Preview', value: message.content.slice(0, 100) + '...', inline: false }
        )
        .setFooter({ text: 'Repeated violations may result in mutes or bans' })
        .setTimestamp();

      // Add Arabic description if relevant
      if (violationResult.language === 'arabic') {
        warningDM.addFields({
          name: 'المخالفة',
          value: arabicDesc + arabicTypoMessage,
          inline: false
        });
      }

      await message.author.send({ embeds: [warningDM] });
      console.log(`📨 Sent warning DM to ${message.author.tag}`);
    } catch (dmError) {
      console.log(`❌ Could not send DM to ${message.author.tag}: ${dmError.message}`);
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

  static async logViolation(message, violationResult) {
    try {
      const config = getServerConfig(message.guild.id);
      const logChannel = message.guild.channels.cache.get(config.logChannel);
      
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('🛡️ Auto-Moderation Action')
          .setColor(0xFF0000)
          .setDescription(`Message from ${message.author} was flagged`)
          .addFields(
            { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
            { name: 'Channel', value: `${message.channel}`, inline: true },
            { name: 'Violation', value: BilingualAutoMod.getViolationDescription(violationResult.violations, 'english'), inline: true },
            { name: 'Severity', value: violationResult.severity.toUpperCase(), inline: true },
            { name: 'Language', value: violationResult.language.toUpperCase(), inline: true },
            { name: 'Message Content', value: message.content.slice(0, 1024), inline: false }
          )
          .setTimestamp()
          .setFooter({ text: 'Auto-Moderation System' });

        await logChannel.send({ embeds: [logEmbed] });
      }
    } catch (error) {
      console.error('Error logging violation:', error);
    }
  }
}

// SIMPLIFIED YouTube URL validation - Much more reliable
function validateYouTubeUrl(url) {
  try {
    // First, try ytdl's built-in validation (most reliable)
    if (ytdl.validateURL(url)) {
      return {
        isValid: true,
        videoId: extractVideoIdSimple(url),
        normalizedUrl: url
      };
    }

    // If that fails, try to extract video ID from common patterns
    const videoId = extractVideoIdSimple(url);
    if (videoId && videoId.length === 11) {
      const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      // Test if this normalized URL works with ytdl
      if (ytdl.validateURL(normalizedUrl)) {
        return {
          isValid: true,
          videoId: videoId,
          normalizedUrl: normalizedUrl
        };
      }
    }

    return { isValid: false };
  } catch (error) {
    console.error('URL validation error:', error);
    return { isValid: false };
  }
}

// Simple video ID extraction
function extractVideoIdSimple(url) {
  // Handle youtu.be short URLs
  if (url.includes('youtu.be/')) {
    const match = url.match(/youtu\.be\/([^&?\/]+)/);
    return match ? match[1] : null;
  }
  
  // Handle youtube.com URLs
  if (url.includes('youtube.com')) {
    const match = url.match(/[?&]v=([^&?\/]+)/);
    return match ? match[1] : null;
  }
  
  // Handle youtube.com/embed/ URLs
  if (url.includes('youtube.com/embed/')) {
    const match = url.match(/youtube\.com\/embed\/([^&?\/]+)/);
    return match ? match[1] : null;
  }
  
  return null;
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

// Message content handler for bilingual auto-moderation
client.on('messageCreate', async (message) => {
  // Ignore bots and system messages
  if (message.author.bot || !message.guild) return;

  console.log(`📨 Message from ${message.author.tag}: "${message.content}"`);

  try {
    // Check for auto-mod violations
    const violationResult = BilingualAutoMod.checkMessage(message.content, message.guild.id);
    
    if (violationResult) {
      console.log(`🛡️ VIOLATION DETECTED:`, violationResult);
      await AutoModSystem.handleViolation(message, violationResult);
    } else {
      console.log(`✅ No violations detected`);
    }
  } catch (error) {
    console.error('Error in message auto-moderation:', error);
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

// Event Handlers
client.once('ready', async (c) => {
  console.log(`✅ Bot is ready! Logged in as ${c.user.tag}`);
  const serverCount = c.guilds.cache.size;
  console.log(`📊 Serving ${serverCount} server(s)`);
  
  // Auto-enable auto-mod for all guilds
  c.guilds.cache.forEach(guild => {
    const config = getServerConfig(guild.id);
    if (!config.autoModSettings.enabled) {
      console.log(`🛡️ Auto-enabling auto-mod for ${guild.name}`);
      config.autoModSettings.enabled = true;
    }
  });
  await saveConfig();

  // Set activity
  client.user.setActivity({
    name: `${serverCount} servers | Auto-mod Active`,
    type: ActivityType.Watching
  });

  console.log(`🎯 Activity set: Auto-mod is ACTIVE in all servers`);
});

client.on('guildMemberAdd', async (member) => {
  console.log(`👋 New member joined: ${member.user.tag}`);
});

client.on('guildMemberRemove', async (member) => {
  console.log(`👋 Member left: ${member.user.tag}`);
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

// Get token from environment variables
const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('❌ ERROR: DISCORD_BOT_TOKEN is not set!');
  console.log('💡 Make sure you have a .env file with your bot token');
  process.exit(1);
}

// Login to Discord
console.log('🔐 Attempting to login to Discord...');
console.log('🛡️ Auto-mod will be AUTOMATICALLY ENABLED in all servers');
client.login(token).catch(error => {
  console.error('❌ Failed to login:', error.message);
  process.exit(1);
});