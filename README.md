# Crypto Pump/Dump Detection Bot

A Node.js bot that monitors cryptocurrency trading pairs on Binance for unusual volume spikes that may indicate pump or dump activities. The bot sends real-time alerts via Telegram when suspicious trading patterns are detected.

## Telegram signal chanel

**@dp_crypto**

## Features

- **Real-time Monitoring**: WebSocket connection to Binance for live 1-minute candle data
- **Volume Analysis**: Calculates 14-day average hourly volume for baseline comparison
- **Pump/Dump Detection**: Identifies unusual volume spikes and determines buy vs sell pressure
- **Telegram Alerts**: Sends formatted notifications with detailed trading information
- **Automated Scheduling**: Periodic recalculation of volume averages and data cleanup
- **Error Handling**: Robust error handling with automatic reconnection
- **Graceful Shutdown**: Clean process termination with resource cleanup

## Prerequisites

- Node.js (v14 or higher)
- Binance API account with API key and secret
- Telegram bot token
- Active internet connection

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd pump-dump-bot
```

2. Install dependencies:
```bash
npm install
```

3. Install required packages:
```bash
npm install binance-api-node dayjs dotenv
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
BINANCE_PUBLIC_KEY=your_binance_api_key
BINANCE_PRIVATE_KEY=your_binance_api_secret
TELEGRAM_TOKEN=your_telegram_bot_token
```

### Token Configuration

Create `tokens1.json` with your monitored tokens:

```json
{
  "BTC": {
    "isStarted": true
  },
  "ETH": {
    "isStarted": true
  }
}
```

### Telegram Module

Ensure you have a `telegram.js` module with a `sendMessage` function:

```javascript
// telegram.js example
const axios = require('axios');

async function sendMessage(message, token) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await axios.post(url, {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
    });
}

module.exports = { sendMessage };
```

## Usage

Start the bot:

```bash
node bot01.js
```

Or with npm script:

```bash
npm start
```

## How It Works

### Volume Analysis
- Fetches 14 days of historical daily candle data
- Calculates average hourly quote volume for each token
- Updates baseline every 6 hours

### Detection Logic
- Monitors real-time 1-minute candles via WebSocket
- Compares current volume against historical average
- Triggers alerts when volume exceeds average threshold
- Determines pump vs dump based on buy/sell volume ratio

## Scheduling

- **Volume Recalculation**: Every 6 hours
- **Data Cleanup**: Every 1 hour (resets isStarted flags)
- **Real-time Monitoring**: Continuous via WebSocket

## Project Structure

```
pump-dump-bot/
├── bot1.js     # Main bot application
├── telegram.js          # Telegram messaging module
├── tokens1.json         # Token configuration
├── stat1.json          # Statistics tracking
├── .env                # Environment variables
├── package.json        # Node.js dependencies
└── README.md           # This file
```

## API Limits

- Binance API: Respects rate limits with 200ms delays between calls
- Telegram API: No specific rate limiting implemented

## Error Handling

- **API Failures**: Logged with context, operation continues
- **WebSocket Disconnection**: Automatic reconnection after 5 seconds
- **File Operations**: Errors logged, operation retried
- **Missing Data**: Graceful handling of incomplete token information

## Security Considerations

- Store API credentials in environment variables only
- Never commit `.env` file to version control
- Use read-only Binance API permissions if possible
- Regularly rotate API keys

## Troubleshooting

### Common Issues

1. **WebSocket Connection Fails**
    - Check internet connectivity
    - Verify Binance API credentials
    - Ensure API key has spot trading permissions

2. **No Alerts Received**
    - Verify Telegram bot token and chat ID
    - Check token configuration (`isStarted: true`)
    - Confirm volume thresholds are appropriate

3. **High CPU Usage**
    - Reduce number of monitored tokens
    - Increase API delay interval
    - Monitor memory usage for leaks

### Debug Mode

Add console logging for debugging:

```javascript
// Add to detectPumpDump method
console.log(`Debug: ${tokenSymbol} - Current: ${currentVolume}, Avg: ${avgVolume}`);
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Disclaimer

This bot is for educational and monitoring purposes only. Cryptocurrency trading involves significant risk. The bot's alerts should not be considered as financial advice. Always do your own research before making trading decisions.

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Create an issue in the repository
- Check existing issues for solutions
- Review Binance API documentation for API-related problems