require("dotenv").config();
const Binance = require('binance-api-node');
const dayjs = require("dayjs");
const telegram = require('./telegram');
const {writeFile} = require("node:fs/promises");

// Constants
const TOKENS_FILE = './tokens1.json';
const STAT_FILE = './stat1.json';
const AVG_VOLUME_INTERVAL = 21_600_000; // 6 hours
const CLEANUP_INTERVAL = 3_600_000; // 1 hour
const API_DELAY = 200; // ms between API calls
const VOLUME_HISTORY_DAYS = 14;

class PumpDumpBot {
    constructor() {
        this.tokens = require(TOKENS_FILE);
        this.count = require(STAT_FILE).count;
        this.client = Binance.default({
            apiKey: process.env.BINANCE_PUBLIC_KEY,
            apiSecret: process.env.BINANCE_PRIVATE_KEY,
        });
        this.tgToken = process.env.TELEGRAM_TOKEN;
        this.wsConnection = null;
    }

    log(message) {
        const timeLog = dayjs().format('HH:mm:ss');
        console.log(`${timeLog} ${message}`);
    }

    async writeTokensFile() {
        try {
            await writeFile(TOKENS_FILE, JSON.stringify(this.tokens, null, 2));
            this.log("✅ Tokens file updated successfully");
        } catch (error) {
            console.error("❌ Error writing tokens file:", error);
        }
    }

    async calculateAverageVolume() {
        this.log("📊 Calculating average volumes...");

        const tokenSymbols = Object.keys(this.tokens);
        let processed = 0;

        for (const token of tokenSymbols) {
            try {
                const symbol = `${token}USDT`;
                const candles = await this.client.candles({
                    symbol,
                    interval: "1d",
                    limit: VOLUME_HISTORY_DAYS
                });

                // Calculate average hourly quote volume
                const totalVolume = candles.reduce((sum, candle) => {
                    return sum + parseFloat(candle.quoteVolume);
                }, 0);

                this.tokens[token].avgQuoteVolume = totalVolume / candles.length / 24;

                processed++;
                this.log(`📈 ${symbol}: ${this.tokens[token].avgQuoteVolume.toFixed(2)} USDT/hour (${processed}/${tokenSymbols.length})`);

                // Rate limiting
                await this.delay(API_DELAY);

            } catch (error) {
                console.error(`❌ Error calculating volume for ${token}:`, error.message);
            }
        }

        await this.writeTokensFile();
        this.log("✅ Average volume calculation completed");
    }

    async cleanupTokenData() {
        this.log("🧹 Cleaning up token data...");

        let cleanedCount = 0;
        for (const token of Object.keys(this.tokens)) {
            if (this.tokens[token].isStarted) {
                delete this.tokens[token].isStarted;
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            await this.writeTokensFile();
            this.log(`✅ Cleaned ${cleanedCount} tokens`);
        } else {
            this.log("ℹ️ No cleanup needed");
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    setupScheduledTasks() {
        const now = dayjs();
        const secondsToNextMinute = 60 - now.second();
        const msToNextMinute = secondsToNextMinute * 1000;

        this.log(`⏱️ Scheduling tasks to start in ${secondsToNextMinute} seconds`);

        // Schedule average volume calculation every 6 hours
        setTimeout(() => {
            setInterval(() => this.calculateAverageVolume(), AVG_VOLUME_INTERVAL);
        }, msToNextMinute);

        // Schedule cleanup every hour
        setTimeout(() => {
            setInterval(() => this.cleanupTokenData(), CLEANUP_INTERVAL);
        }, msToNextMinute);
    }

    async sendTelegramAlert(message) {
        try {
            await telegram.sendMessage(message, this.tgToken);
            this.log(`📱 Alert sent: ${message}`);
        } catch (error) {
            console.error("❌ Failed to send Telegram message:", error.message);
        }
    }

    detectPumpDump(candle) {
        const tokenSymbol = candle.symbol.slice(0, -4); // Remove 'USDT'
        const token = this.tokens[tokenSymbol];

        if (!token) {
            console.warn(`⚠️ Unknown token: ${tokenSymbol}`);
            return;
        }

        if (!token.avgQuoteVolume) {
            // Skip if we don't have average volume data yet
            return;
        }

        const currentVolume = parseFloat(candle.quoteVolume);
        const avgVolume = token.avgQuoteVolume;
        const volumeRatio = currentVolume / avgVolume;

        // Only trigger if volume is significantly above average and token monitoring is enabled
        if (currentVolume > avgVolume && token.isStarted) {
            const totalVolume = parseFloat(candle.volume);
            const buyVolume = parseFloat(candle.buyVolume);
            const sellVolume = totalVolume - buyVolume;

            // Determine direction based on buy vs sell volume
            const isPump = buyVolume > sellVolume;
            const direction = isPump ? 'PUMP 🚀' : 'DUMP 📉';

            const message = `${direction} detected for ${tokenSymbol}
📊 Volume: ${currentVolume.toFixed(2)} USDT (${volumeRatio.toFixed(2)}x avg)
💰 Buy: ${buyVolume.toFixed(2)} | Sell: ${sellVolume.toFixed(2)}
⏰ Time: ${dayjs().format('HH:mm:ss')}`;
            this.sendTelegramAlert(message);
        }
    }

    startWebSocketMonitoring() {
        const pairs = Object.keys(this.tokens).map(key => `${key}USDT`);

        this.log(`👁️ Starting WebSocket monitoring for ${pairs.length} pairs`);

        try {
            this.wsConnection = this.client.ws.candles(pairs, '1m', (candle) => {
                this.detectPumpDump(candle);
            });
            this.log("✅ WebSocket connection established");
        } catch (error) {
            console.error("❌ WebSocket connection failed:", error);
            setTimeout(() => this.startWebSocketMonitoring(), 5000);
        }
    }

    async start() {
        this.log("💵 == PUMP/DUMP BOT STARTING == 💵");

        try {
            if (!process.env.BINANCE_PUBLIC_KEY || !process.env.BINANCE_PRIVATE_KEY) {
                throw new Error("Missing Binance API credentials");
            }
            if (!process.env.TELEGRAM_TOKEN) {
                throw new Error("Missing Telegram token");
            }
            await this.calculateAverageVolume();
            this.setupScheduledTasks();
            this.startWebSocketMonitoring();
            this.log("🚀 Bot is now running!");
        } catch (error) {
            console.error("❌ Bot startup failed:", error);
            process.exit(1);
        }
    }

    stop() {
        this.log("🛑 Shutting down bot...");

        if (this.wsConnection) {
            this.wsConnection();
            this.log("✅ WebSocket connection closed");
        }

        this.log("👋 Bot stopped");
    }
}

process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    if (global.bot) {
        global.bot.stop();
    }
    process.exit(0);
});

const bot = new PumpDumpBot();
global.bot = bot; // Store reference for graceful shutdown
bot.start().catch(error => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
});