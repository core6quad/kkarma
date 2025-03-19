require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const osUtils = require('os-utils');

// Конфигурационные константы
const DEFAULT_COOLDOWN = 1000;
const COLORS = {
    INFO: '#0099ff',
    ERROR: '#ff0000'
};
const EMOJI_MAP = {
    UPVOTE: '⬆️',
    DOWNVOTE: '⬇️'
};
const CHANNEL_ID = '840600744964915210'; 

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent 
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
    if (message.author.bot || !message.content.startsWith(config.prefix)) return;

    const now = Date.now();
    const cooldown = cooldowns.get(message.author.id) || 0;
    
    if (now < cooldown + config.cooldown) {
        const remaining = (cooldown + config.cooldown - now) / 1000;
        return message.channel.send({ 
            embeds: [createEmbed(COLORS.ERROR, `Please wait ${remaining.toFixed(1)}s before reusing commands.`)]
        });
    }

    cooldowns.set(message.author.id, now);
    setTimeout(() => cooldowns.delete(message.author.id), config.cooldown);

    const [command, ...args] = message.content.slice(config.prefix.length).trim().split(/ +/);
    const guildId = message.guild.id;

    try {
        const karmaData = await loadKarma(guildId);
        
        switch(command.toLowerCase()) {
            case 'ping':
                message.channel.send({ embeds: [createEmbed(COLORS.INFO, 'Pong.')] });
                break;
                
            case 'karma': {
                const targetUser = message.mentions.users.first() || message.author;
                const reply = await message.channel.send({
                    embeds: [createEmbed(COLORS.INFO, 
                        `${targetUser.username} has ${karmaData[targetUser.id] || 0} karma.`
                    )]
                });

                if (message.author.id === CHANNEL_ID) {
                    try {
                        await message.delete();
                        console.log(`Deleted message from ${TARGET_USER_ID}`);
                    } catch (err) {
                        console.error('Failed to delete message:', err);
                    }
                }
                break;
            }
                
            case 'leaderboard': {
                const topUsers = Object.entries(karmaData)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 3);
                
                const leaderboard = topUsers.length 
                    ? await Promise.all(topUsers.map(async ([id, karma], index) => {
                        const user = await client.users.fetch(id).catch(() => ({ username: 'Unknown' }));
                        return `${index + 1}. ${user.username} - ${karma} karma`;
                    }))
                    : ['No data'];
                
                message.channel.send({
                    embeds: [createEmbed(COLORS.INFO,
                        `Top 3 Users:\n${leaderboard.join('\n')}`
                    )]
                });
                break;
            }
                
            case 'reset':
                if (message.author.id !== config.adminId) {
                    return message.channel.send({
                        embeds: [createEmbed(COLORS.ERROR, 'Insufficient permissions.')]
                    });
                }
                await saveKarma(guildId, {});
                message.channel.send({ embeds: [createEmbed(COLORS.INFO, 'Karma reset.')] });
                break;
                
            case 'host':
                const ping = Date.now() - message.createdTimestamp;
                const [cpuLoad, memTotal, memFree] = await Promise.all([
                    new Promise(res => osUtils.cpuUsage(res)),
                    os.totalmem() / 1024 ** 2,
                    os.freemem() / 1024 ** 2
                ]);
                
                message.channel.send({
                    embeds: [new EmbedBuilder()
                        .setColor(COLORS.INFO)
                        .setTitle('Server Metrics')
                        .addFields(
                            { name: 'CPU Load', value: `${(cpuLoad * 100).toFixed(2)}%`, inline: true },
                            { name: 'CPU Cores', value: os.cpus().length.toString(), inline: true },
                            { name: 'Memory Usage', value: `${(memTotal - memFree).toFixed(2)}MB/${memTotal.toFixed(2)}MB`, inline: true },
                            { name: 'Latency', value: `${ping}ms`, inline: true }
                        )]
                });
                break;
        }
    } catch (err) {
        console.error('Command handling error:', err);
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
