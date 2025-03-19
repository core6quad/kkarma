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
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

// Конфигурация из .env
const config = {
    selfInteraction: process.env.ITSELF_INTERACTION === 'true',
    adminId: process.env.ADMIN_ID,
    cooldown: Number(process.env.COOLDOWN) || DEFAULT_COOLDOWN,
    prefix: process.env.PREFIX || '!'
};

const cooldowns = new Map();
const dataDir = path.join(__dirname, 'data');

// Инициализация директории данных
(async () => {
    try {
        await fs.access(dataDir);
    } catch {
        await fs.mkdir(dataDir, { recursive: true });
    }
})();

// Вспомогательные функции
const getKarmaPath = guildId => path.join(dataDir, `${guildId}.json`);

async function loadKarma(guildId) {
    try {
        return JSON.parse(await fs.readFile(getKarmaPath(guildId), 'utf8');
    } catch {
        return {};
    }
}

async function saveKarma(guildId, data) {
    await fs.writeFile(getKarmaPath(guildId), JSON.stringify(data));
}

function createEmbed(color, description) {
    return new EmbedBuilder().setColor(color).setDescription(description);
}

// Обработчики событий
client.once('ready', () => console.log(`Logged in as ${client.user.tag}!`));

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
                await message.channel.send({
                    embeds: [createEmbed(COLORS.INFO, 
                        `${targetUser.username} has ${karmaData[targetUser.id] || 0} karma.`
                    )]
                });

                if (message.author.id === CHANNEL_ID) {
                    await message.delete().catch(console.error);
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
                        embeds: [createEmbed(COLORS.ERROR, '❌ Insufficient permissions.')]
                    });
                }
                await saveKarma(guildId, {});
                message.channel.send({ embeds: [createEmbed(COLORS.INFO, '✅ Karma reset.')] });
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
                        .setTitle('🖥 Server Metrics')
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
        console.error('Command error:', err);
        message.channel.send({ 
            embeds: [createEmbed(COLORS.ERROR, '❌ An error occurred while processing the command.')]
        });
    }
});

// Обработчики реакций
async function handleReaction(reaction, user, operation) {
    if (user.bot) return;

    try {
        if (reaction.partial) await reaction.fetch();
        if (!config.selfInteraction && user.id === reaction.message.author.id) return;

        const guildId = reaction.message.guild.id;
        const karmaData = await loadKarma(guildId);
        const userId = reaction.message.author.id;

        const value = {
            [EMOJI_MAP.UPVOTE]: operation === 'add' ? 1 : -1,
            [EMOJI_MAP.DOWNVOTE]: operation === 'add' ? -1 : 1
        }[reaction.emoji.name];

        if (value) {
            karmaData[userId] = (karmaData[userId] || 0) + value;
            await saveKarma(guildId, karmaData);
            reaction.message.channel.send({
                embeds: [createEmbed(COLORS.INFO,
                    `${reaction.message.author.username} now has ${karmaData[userId]} karma.`
                )]
            });
        }
    } catch (err) {
        console.error('Reaction error:', err);
    }
}

client.on('messageReactionAdd', (r, u) => handleReaction(r, u, 'add'));
client.on('messageReactionRemove', (r, u) => handleReaction(r, u, 'remove'));

client.login(process.env.DISCORD_TOKEN);
