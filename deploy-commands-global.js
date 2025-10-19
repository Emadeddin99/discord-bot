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
        name: 'user', type: 6, description: 'The user to get info about', required: false
      }
    ]
  },
  {
    name: 'avatar', description: "Get a user's avatar",
    options: [
      {
        name: 'user', type: 6, description: 'The user to get the avatar of', required: false
      }
    ]
  },
  {
    name: 'membercount', description: 'Show the current member count'
  },
  {
    name: 'join', description: 'Join your voice channel'
  },
  {
    name: 'leave', description: 'Leave the voice channel'
  },
  {
    name: 'play', description: 'Play music from a YouTube URL',
    options: [
      {
        name: 'url', type: 3, description: 'YouTube URL to play', required: true
      }
    ]
  },
  {
    name: 'skip', description: 'Skip the current song'
  },
  {
    name: 'stop', description: 'Stop the music and clear the queue'
  },
  {
    name: 'queue', description: 'Show the current music queue'
  },
  {
    name: 'volume', description: 'Set the music volume',
    options: [
      {
        name: 'volume', type: 4, description: 'Volume level (1-100)', required: true,
        min_value: 1, max_value: 100
      }
    ]
  },
  {
    name: 'nowplaying', description: 'Show the currently playing song'
  },
  {
    name: 'level', description: 'Check your level or another user\'s level',
    options: [
      {
        name: 'user', type: 6, description: 'The user to check level for', required: false
      }
    ]
  },
  {
    name: 'leaderboard', description: 'Show the server level leaderboard'
  }
];