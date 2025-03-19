require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const osUtils = require('os-utils');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const itselfInteraction = process.env.ITSELF_INTERACTION === 'true';
const adminId = process.env.ADMIN_ID;
const cooldownAmount = parseInt(process.env.COOLDOWN) || 1000; // Default to 1000ms if not set
const prefix = process.env.PREFIX || '!';
const cooldowns = new Map();

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

function getKarmaFilePath(guildId) {
    return path.join(dataDir, `${guildId}.json`);
}

function loadKarmaData(guildId) {
    const filePath = getKarmaFilePath(guildId);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    return {};
}

function saveKarmaData(guildId, data) {
    const filePath = getKarmaFilePath(guildId);
    fs.writeFileSync(filePath, JSON.stringify(data));
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (!message.content.startsWith(prefix)) return;

    const now = Date.now();

    if (cooldowns.has(message.author.id)) {
        const expirationTime = cooldowns.get(message.author.id) + cooldownAmount;
        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setDescription(`Please wait ${timeLeft.toFixed(1)} more second(s) before reusing the command.`);
            return message.channel.send({ embeds: [embed] });
        }
    }

    cooldowns.set(message.author.id, now);
    setTimeout(() => cooldowns.delete(message.author.id), cooldownAmount);

    const guildId = message.guild.id;
    let userKarma = loadKarmaData(guildId);

    const args = message.content.slice(prefix.length).trim().split(' ');
    const command = args.shift().toLowerCase();

    if (command === 'ping') {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setDescription('Pong.');
        message.channel.send({ embeds: [embed] });
    } else if (command === 'karma') {
        const user = message.mentions.users.first() || message.author;
        const karma = userKarma[user.id] || 0;
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setDescription(`${user.username} has ${karma} karma.`);
        message.channel.send({ embeds: [embed] });
    } else if (command === 'leaderboard') {
        const sortedUsers = Object.keys(userKarma).sort((a, b) => userKarma[b] - userKarma[a]);
        const topUsers = sortedUsers.slice(0, 3);
        let leaderboard = 'Top 3 Users by Karma:\n';
        if (topUsers.length === 0) {
            leaderboard = 'No data';
        } else {
            const userPromises = topUsers.map(async (userId, index) => {
                let user = client.users.cache.get(userId);
                if (!user) {
                    user = await client.users.fetch(userId);
                }
                return `${index + 1}. ${user.username} - ${userKarma[userId]} karma\n`;
            });
            const userResults = await Promise.all(userPromises);
            leaderboard += userResults.join('');
        }
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setDescription(leaderboard);
        message.channel.send({ embeds: [embed] });
    } else if (command === 'reset') {
        if (message.author.id === adminId) {
            userKarma = {};
            saveKarmaData(guildId, userKarma);
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setDescription('Karma has been reset.');
            message.channel.send({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setDescription('You do not have permission to use this command.');
            message.channel.send({ embeds: [embed] });
        }
    } else if (command === 'host') {
        osUtils.cpuUsage(cpuLoad => {
            const cpuCores = os.cpus().length;
            const totalMem = (os.totalmem() / 1024 / 1024).toFixed(2);
            const freeMem = (os.freemem() / 1024 / 1024).toFixed(2);
            const usedMem = (totalMem - freeMem).toFixed(2);
            const ping = Date.now() - message.createdTimestamp;

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Host Information')
                .addFields(
                    { name: 'CPU Load', value: `${(cpuLoad * 100).toFixed(2)}%`, inline: true },
                    { name: 'CPU Cores', value: `${cpuCores}`, inline: true },
                    { name: 'RAM Usage', value: `${usedMem} MB / ${totalMem} MB`, inline: true },
                    { name: 'Ping', value: `${ping} ms`, inline: true }
                );
            message.channel.send({ embeds: [embed] });
        });
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    // Fetch the message if it's a partial
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Something went wrong when fetching the message:', error);
            return;
        }
    }

    const message = reaction.message;
    const messageAuthor = message.author;
    const guildId = message.guild.id;
    let userKarma = loadKarmaData(guildId);

    if (!itselfInteraction && user.id === messageAuthor.id) return;

    if (reaction.emoji.name === '⬆️') {
        userKarma[messageAuthor.id] = (userKarma[messageAuthor.id] || 0) + 1;
        saveKarmaData(guildId, userKarma);
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setDescription(`${messageAuthor.username} now has ${userKarma[messageAuthor.id]} karma.`);
        message.channel.send({ embeds: [embed] });
    } else if (reaction.emoji.name === '⬇️') {
        userKarma[messageAuthor.id] = (userKarma[messageAuthor.id] || 0) - 1;
        saveKarmaData(guildId, userKarma);
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setDescription(`${messageAuthor.username} now has ${userKarma[messageAuthor.id]} karma.`);
        message.channel.send({ embeds: [embed] });
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;

    // Fetch the message if it's a partial
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Something went wrong when fetching the message:', error);
            return;
        }
    }

    const message = reaction.message;
    const messageAuthor = message.author;
    const guildId = message.guild.id;
    let userKarma = loadKarmaData(guildId);

    if (!itselfInteraction && user.id === messageAuthor.id) return;

    if (reaction.emoji.name === '⬆️') {
        userKarma[messageAuthor.id] = (userKarma[messageAuthor.id] || 0) - 1;
        saveKarmaData(guildId, userKarma);
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setDescription(`${messageAuthor.username} now has ${userKarma[messageAuthor.id]} karma.`);
        message.channel.send({ embeds: [embed] });
    } else if (reaction.emoji.name === '⬇️') {
        userKarma[messageAuthor.id] = (userKarma[messageAuthor.id] || 0) + 1;
        saveKarmaData(guildId, userKarma);
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setDescription(`${messageAuthor.username} now has ${userKarma[messageAuthor.id]} karma.`);
        message.channel.send({ embeds: [embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);
