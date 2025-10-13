require("dotenv").config();
const Binance = require('binance-api-node');
const dayjs = require("dayjs");
const telegram = require('./telegram');
const {writeFile} = require("node:fs/promises");

// Constants
const TOKENS_FILE = './tokens1.json';
const STAT_FILE = './stat1.json';

class ExtremumTradingBot {
    constructor() {
        this.tokens = require(TOKENS_FILE);
        this.count = require(STAT_FILE).count;
        this.client = Binance.default({
            apiKey: process.env.BINANCE_PUBLIC_KEY, apiSecret: process.env.BINANCE_PRIVATE_KEY,
        });
        this.tgToken = process.env.TELEGRAM_TOKEN3;
        this.hourlyUpdateInterval = null;
    }

    log(message) {
        const timeLog = dayjs().format('HH:mm:ss');
        console.log(`${timeLog} ${message}`);
    }

    async writeTokensFile() {
        try {
            await writeFile(TOKENS_FILE, JSON.stringify(this.tokens, null, 2));
        } catch (error) {
            console.error("❌ Error writing tokens file:", error);
        }
    }

    async writeStatFile() {
        try {
            await writeFile(STAT_FILE, JSON.stringify({count: this.count}, null, 2));
        } catch (error) {
            console.error("❌ Error writing stats file:", error);
        }
    }

    async sendTelegramAlert(message, isSilent) {
        try {
            await telegram.sendMessage(message, this.tgToken, isSilent);
            this.log(`📱 Alert sent: ${message}`);
        } catch (error) {
            console.error("❌ Failed to send Telegram message:", error.message);
        }
    }

    async logTop10Diff() {
        const diffs = Object.entries(this.tokens)
            .map(([symbol, token]) => {
                const { spot, futures, price } = token;
                if (!spot || !futures) return null;
                const diff = futures - spot;
                const diffPct = (diff / spot) * 100;
                return { symbol, price, spot, futures, diffPct };
            })
            .filter(Boolean)
            .filter(r => Math.abs(r.diffPct) > 0.5) // 🔥 фильтруем > 0.5%
            .sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));

        diffs.forEach(({ symbol, price, spot, futures, diffPct }, i) => {
            this.log(
                `${symbol.padEnd(8)} ` +
                `cmc:${+price.toFixed(6).padEnd(12)} ` +
                `spot:${spot.toFixed(6).padEnd(12)} ` +
                `futures:${futures.toFixed(6).padEnd(12)} ` +
                `diff: ${diffPct.toFixed(2)}%`
            );
        });
    }

    async updateAllHourly() {
        let spot = await this.client.prices()
        let futures = await this.client.futuresPrices()
        const updatePromises = Object.keys(this.tokens).map(async (tokenSymbol) => {
            const token = this.tokens[tokenSymbol];
            token.spot = parseFloat(spot[`${tokenSymbol}USDT`])
            token.futures = parseFloat(futures[`${tokenSymbol}USDT`])
        });

        await Promise.all(updatePromises);
        await this.logTop10Diff()
        await this.writeTokensFile();
    }



    startHourlyUpdates() {
        this.updateAllHourly().catch(error => {
            console.error("❌ Error in initial hourly volume update:", error);
        });
        this.hourlyUpdateInterval = setInterval(() => {
            this.updateAllHourly().catch(error => {
                console.error("❌ Error in periodic hourly volume update:", error);
            });
        }, 600_000);
    }

    async start() {
        this.log("📊 == EXTREMUM TRADING BOT STARTING == 📊");
        try {
            if (!process.env.BINANCE_PUBLIC_KEY || !process.env.BINANCE_PRIVATE_KEY) {
                throw new Error("Missing Binance API credentials");
            }
            if (!process.env.TELEGRAM_TOKEN3) {
                throw new Error("Missing Telegram token");
            }
            await this.startHourlyUpdates();
            this.log("🚀 Bot is now running with extremum tracking and hourly volume API updates!");
        } catch (error) {
            console.error("❌ Bot startup failed:", error);
            process.exit(1);
        }
    }

    stop() {
        this.log("🛑 Shutting down bot...");
        if (this.hourlyUpdateInterval) {
            clearInterval(this.hourlyUpdateInterval);
            this.log("✅ Hourly update interval cleared");
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

const bot = new ExtremumTradingBot();
global.bot = bot;
bot.start().catch(error => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
});