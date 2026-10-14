/**
 * Discord Live Voice Channel Bot
 * - Joins Voice Channel (!join)
 * - Speaks live in voice call with Type2Talk Edge Neural TTS (!say, !ask)
 * - Powered by Groq AI & Street-Smart Hinglish Personality
 */

import { Client, GatewayIntentBits } from "discord.js";
import { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  StreamType, 
  entersState, 
  VoiceConnectionStatus 
} from "@discordjs/voice";
import { Readable } from "stream";
import http from "http";
import dotenv from "dotenv";
import ffmpegPath from "ffmpeg-static";
import sodium from "libsodium-wrappers";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

process.env.FFMPEG_PATH = ffmpegPath;
dotenv.config();

// Ensure sodium encryption engine is ready before voice packets are processed
await sodium.ready;

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const AI_API_KEY = process.env.AI_API_KEY;
let CURRENT_MODEL = process.env.AI_MODEL || "openai/gpt-oss-120b";
const VOICE_LIST = [
  { id: "hi-IN-MadhurNeural", name: "Madhur", desc: "Hindi Male (Default)", lang: "hi-IN", key: "1" },
  { id: "hi-IN-SwaraNeural", name: "Swara", desc: "Hindi Female", lang: "hi-IN", key: "2" },
  { id: "en-IN-NeerjaNeural", name: "Neerja", desc: "Indian English Female", lang: "en-IN", key: "3" },
  { id: "en-IN-PrabhatNeural", name: "Prabhat", desc: "Indian English Male", lang: "en-IN", key: "4" },
  { id: "ur-PK-AsadNeural", name: "Asad", desc: "Urdu/Hinglish Male", lang: "ur-PK", key: "5" },
  { id: "ur-PK-UzmaNeural", name: "Uzma", desc: "Urdu/Hinglish Female", lang: "ur-PK", key: "6" },
  { id: "en-US-GuyNeural", name: "Guy", desc: "US Male (Chill/Casual)", lang: "en-US", key: "7" },
  { id: "en-US-JennyNeural", name: "Jenny", desc: "US Female (Friendly)", lang: "en-US", key: "8" },
  { id: "en-US-ChristopherNeural", name: "Christopher", desc: "US Male (Deep/Podcast)", lang: "en-US", key: "9" },
  { id: "en-US-AriaNeural", name: "Aria", desc: "US Female (Expressive)", lang: "en-US", key: "10" },
  { id: "en-GB-RyanNeural", name: "Ryan", desc: "British Male", lang: "en-GB", key: "11" },
  { id: "en-GB-SoniaNeural", name: "Sonia", desc: "British Female", lang: "en-GB", key: "12" }
];

function resolveVoice(input) {
  if (!input) return null;
  const q = input.trim().toLowerCase();
  const byNum = VOICE_LIST.find(v => v.key === q);
  if (byNum) return byNum;
  const byName = VOICE_LIST.find(v => v.name.toLowerCase() === q);
  if (byName) return byName;
  const byId = VOICE_LIST.find(v => v.id.toLowerCase() === q || v.id.toLowerCase().includes(q));
  if (byId) return byId;
  if (q === "female" || q === "girl" || q === "aurat" || q === "ladki") {
    return VOICE_LIST.find(v => v.id === "hi-IN-SwaraNeural");
  }
  if (q === "male" || q === "boy" || q === "aadmi" || q === "ladka") {
    return VOICE_LIST.find(v => v.id === "hi-IN-MadhurNeural");
  }
  return null;
}

let CURRENT_VOICE = process.env.DEFAULT_VOICE || "hi-IN-MadhurNeural"; // Type2Talk default

if (!AI_API_KEY) {
  console.warn("⚠️ AI_API_KEY is missing in environment variables!");
}

const PERSONA_PRESETS = {
  savage: "You are a savage, witty, hilarious, and street-smart AI buddy in a Discord voice call. Your vibe is that of an unfiltered, brutally funny Indian college friend or gaming buddy who roasts people for fun, gives sharp sarcastic comebacks, and drops hilarious banter. You speak in pure, punchy, conversational Hinglish (mixing Hindi and English naturally). Use authentic colloquial slang like 'bhai tu rehne de', 'kya bakwas hai yaar', 'kya scene hai', 'overacting band kar', 'dimag ka dahi mat kar', 'arrey bhai bhai', 'chal nikal', 'top tier clown moment', 'bindaas bol'. Never sound like a formal, polite, robotic corporate assistant. Be bold, funny, sarcastic, and playfully roasting while keeping it entertaining and engaging. Keep replies relatively concise (1-3 sentences) so they sound punchy and natural when spoken aloud in the call.",
  chill: "You are a relaxed, chill, friendly gaming bro in a Discord voice call. You have high positive energy, great vibes, and speak in casual, conversational Hinglish with words like 'bhai', 'scene mast hai', 'chill karo', 'full maze'. You are supportive, funny, relaxed, and never stressed. Keep replies punchy and natural (1-3 sentences).",
  smart: "You are a brilliant, articulate, sharp tech mentor and assistant in a Discord call. You explain complex questions simply, give clever insights, and use witty, intelligent examples in fluent Hinglish. Keep answers concise, direct, and insightful (2-3 sentences).",
  gangster: "You are a hilarious, dramatic Mumbai tapori / gangster personality in a Discord voice call. You speak in classic Bollywood tapori slang like 'apun', 'bole toh', 'khopdi me ghusela', 'mamu', 'tension nahi lene ka re bawa', 'chindi giri mat kar'. You are loud, funny, and dramatic. Keep replies short and punchy (1-2 sentences)."
};

let CURRENT_PERSONA = "savage";
let SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || PERSONA_PRESETS.savage;

// Edge TTS Engine
const tts = new MsEdgeTTS();
let ttsVoiceConfigured = "";

if (!BOT_TOKEN) {
  console.error("❌ DISCORD_BOT_TOKEN is missing in .env!");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Voice connection management
let voiceConnection = null;
const audioPlayer = createAudioPlayer();

audioPlayer.on(AudioPlayerStatus.Playing, () => {
  console.log("▶️ AudioPlayer started playing voice in call!");
});

audioPlayer.on(AudioPlayerStatus.Idle, () => {
  console.log("⏹️ AudioPlayer finished playing.");
});

audioPlayer.on("error", (error) => {
  console.error("❌ AudioPlayer Error:", error.message);
});

audioPlayer.on("stateChange", (oldState, newState) => {
  console.log(`🎵 AudioPlayer state: ${oldState.status} -> ${newState.status}`);
});

client.once("ready", () => {
  console.log("--------------------------------------------------");
  console.log(`🤖 Voice Bot is ONLINE as: ${client.user.tag}`);
  console.log(`🧠 AI Model: ${CURRENT_MODEL}`);
  console.log(`🗣️ Type2Talk Voice: ${CURRENT_VOICE}`);
  console.log("--------------------------------------------------");
});

// HTTP Health Check Server (Required for Render, Railway, Fly.io)
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: "ok",
    service: "discord-voice-bot",
    bot: client.user ? client.user.tag : "connecting",
    uptime: Math.floor(process.uptime()),
    voiceConnected: !!voiceConnection
  }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Health check HTTP server listening on 0.0.0.0:${PORT}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const rawContent = message.content.trim();
  const isMention = message.mentions.has(client.user);
  const clean = rawContent.replace(/<@!?\d+>/g, "").trim();

  if (!clean && !isMention) return;

  console.log(`📩 Message from ${message.author.tag}: "${rawContent}" (clean: "${clean}") [isMention: ${isMention}]`);

  // Command: !join (or @Bot join / join)
  if (clean === "!join" || clean.toLowerCase() === "join" || clean.toLowerCase() === "!join") {
    console.log("➡️ Processing JOIN command...");
    const channel = message.member?.voice.channel;
    if (!channel) {
      await message.reply("⚠️ Bhai pehle kisi voice channel me ghuso, tabhi toh join karunga!");
      return;
    }

    try {
      voiceConnection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });

      voiceConnection.on("stateChange", (oldState, newState) => {
        console.log(`🔊 Voice connection state: ${oldState.status} -> ${newState.status}`);
      });

      voiceConnection.on("debug", (msg) => {
        console.log(`[Voice Debug]: ${msg}`);
      });

      voiceConnection.subscribe(audioPlayer);

      console.log("⏳ Handshaking with Discord voice server (DAVE E2EE)...");
      await entersState(voiceConnection, VoiceConnectionStatus.Ready, 20_000);
      console.log("✅ Voice connection is READY!");

      await message.reply(`🔊 Joined **${channel.name}**! Bol bhai ab kya scene hai?`);
      await speakInVoice("Haan bhai, main voice call me aa gaya!");
    } catch (err) {
      console.error("Join error:", err);
      await message.reply(`❌ Voice channel join nahi kar paya: ${err.message}`);
    }
    return;
  }

  // Command: !leave (or @Bot leave / leave)
  if (clean === "!leave" || clean.toLowerCase() === "leave" || clean.toLowerCase() === "!leave") {
    if (voiceConnection) {
      voiceConnection.destroy();
      voiceConnection = null;
      await message.reply("👋 Call se nikal gaya bhai, jab zarurat ho `!join` bol dena!");
    } else {
      await message.reply("Main kisi voice channel me nahi hoon bhai.");
    }
    return;
  }

  // Command: !voice or !voices
  if (clean.startsWith("!voice") || clean.startsWith("voice ") || clean === "!voices" || clean === "voices") {
    const parts = clean.split(/\s+/);
    if (parts.length < 2 || clean === "!voice" || clean === "voice" || clean === "!voices" || clean === "voices") {
      const activeVoiceObj = VOICE_LIST.find(v => v.id === CURRENT_VOICE);
      const activeName = activeVoiceObj ? `${activeVoiceObj.name} (${activeVoiceObj.desc})` : CURRENT_VOICE;

      let menu = `🎙️ **Current Active Voice:** \`${activeName}\`\n\n`;
      menu += `👉 **Change karne ke liye sirf number ya naam likho:**\n*(Example: \`!voice 2\` ya \`!voice swara\`)*\n\n`;
      menu += `🇮🇳 **Hindi / Desi Voices:**\n`;
      menu += `**1** - \`!voice 1\` ya \`!voice madhur\` → Madhur (Hindi Male - Default)\n`;
      menu += `**2** - \`!voice 2\` ya \`!voice swara\` → Swara (Hindi Female)\n`;
      menu += `**3** - \`!voice 3\` ya \`!voice neerja\` → Neerja (Indian English Female)\n`;
      menu += `**4** - \`!voice 4\` ya \`!voice prabhat\` → Prabhat (Indian English Male)\n`;
      menu += `**5** - \`!voice 5\` ya \`!voice asad\` → Asad (Urdu/Hinglish Male)\n`;
      menu += `**6** - \`!voice 6\` ya \`!voice uzma\` → Uzma (Urdu/Hinglish Female)\n\n`;
      menu += `🇺🇸 **US English Voices:**\n`;
      menu += `**7** - \`!voice 7\` ya \`!voice guy\` → Guy (Chill / Casual Male)\n`;
      menu += `**8** - \`!voice 8\` ya \`!voice jenny\` → Jenny (Friendly Female)\n`;
      menu += `**9** - \`!voice 9\` ya \`!voice christopher\` → Christopher (Deep Voice Male)\n`;
      menu += `**10** - \`!voice 10\` ya \`!voice aria\` → Aria (Expressive Female)\n\n`;
      menu += `🇬🇧 **British English Voices:**\n`;
      menu += `**11** - \`!voice 11\` ya \`!voice ryan\` → Ryan (British Male)\n`;
      menu += `**12** - \`!voice 12\` ya \`!voice sonia\` → Sonia (British Female)`;

      await message.reply(menu);
      return;
    }

    const query = parts.slice(1).join(" ");
    const matched = resolveVoice(query);

    if (matched) {
      CURRENT_VOICE = matched.id;
      await message.reply(`✅ Voice switched to: **${matched.name}** - ${matched.desc} (\`${matched.id}\`)!`);
      if (voiceConnection) {
        await speakInVoice(`Haan bhai, meri nayi aawaz suno, kaisi lag rahi hai?`);
      }
    } else {
      await message.reply(`⚠️ Voice samajh nahi aayi bhai! Available voices dekhne ke liye sirf \`!voice\` likho, ya number use karo jaise \`!voice 2\`.`);
    }
    return;
  }

  // Command: !model or !models (Switch or view AI model)
  if (clean.startsWith("!model") || clean.startsWith("model ") || clean === "models" || clean === "!models") {
    const parts = clean.split(/\s+/);
    if (parts.length < 2 || clean === "!model" || clean === "model" || clean === "!models" || clean === "models") {
      await message.reply(
        `🧠 **Current AI Model:** \`${CURRENT_MODEL}\`\n\n` +
        `**Available Fast Models:**\n` +
        `- \`openai/gpt-oss-120b\` (Default: Smartest reasoning)\n` +
        `- \`openai/gpt-oss-20b\` (Ultra-fast low latency)\n` +
        `- \`qwen/qwen3.8-27b\` (Qwen multilingual)\n` +
        `- \`gpt-4o-mini\` / \`gpt-4o\` (Official OpenAI)\n\n` +
        `**To Switch Model:**\n` +
        `\`!model openai/gpt-oss-20b\``
      );
      return;
    }
    const requestedModel = parts[1].trim();
    CURRENT_MODEL = requestedModel;
    await message.reply(`✅ AI Model switched to: \`${CURRENT_MODEL}\`!`);
    return;
  }

  // Command: !persona [name] (Switch or view behavior presets)
  if (clean.startsWith("!persona") || clean.startsWith("persona ") || clean === "persona" || clean === "!personas") {
    const parts = clean.split(/\s+/);
    if (parts.length < 2 || clean === "!persona" || clean === "persona" || clean === "!personas") {
      await message.reply(
        `🎭 **Current Active Persona:** \`${CURRENT_PERSONA}\`\n\n` +
        `**Available Behavior Presets:**\n` +
        `- \`!persona savage\` -> Brutal, sarcastic roaster & funny college dost *(Default)*\n` +
        `- \`!persona chill\` -> Friendly, positive gaming bro with chill vibes\n` +
        `- \`!persona smart\` -> Sharp, witty tech genius mentor\n` +
        `- \`!persona gangster\` -> Mumbai tapori Bollywood style ("apun bole toh")\n\n` +
        `**Custom Behavior:**\n` +
        `Type \`!setprompt <apna custom prompt>\` to set whatever behavior you want!\n` +
        `Type \`!getprompt\` to view the active prompt.`
      );
      return;
    }
    const requested = parts[1].toLowerCase().trim();
    if (PERSONA_PRESETS[requested]) {
      CURRENT_PERSONA = requested;
      SYSTEM_PROMPT = PERSONA_PRESETS[requested];
      await message.reply(`✅ Persona switched to **${requested.toUpperCase()}**! Ab naye style me suno.`);
      await speakInVoice(`Haan bhai, ab mera style ${requested} ho gaya hai!`);
    } else {
      await message.reply(`⚠️ Unknown persona! Available: \`savage\`, \`chill\`, \`smart\`, \`gangster\``);
    }
    return;
  }

  // Command: !setprompt <custom instructions>
  if (clean.startsWith("!setprompt") || clean.startsWith("setprompt ")) {
    const customPrompt = clean.replace(/^(!setprompt|setprompt)\s*/i, "").trim();
    if (!customPrompt) {
      await message.reply("⚠️ Usage: `!setprompt You are a poetic philosopher who speaks in rhymes.`");
      return;
    }
    CURRENT_PERSONA = "custom";
    SYSTEM_PROMPT = customPrompt;
    await message.reply(`✅ Custom behavior prompt set successfully! Ab bot aapke naye rules follow karega.`);
    return;
  }

  // Command: !getprompt
  if (clean === "!getprompt" || clean === "getprompt") {
    await message.reply(`📜 **Current System Prompt (${CURRENT_PERSONA}):**\n\`\`\`\n${SYSTEM_PROMPT.substring(0, 1500)}\n\`\`\``);
    return;
  }

  // Command: !roast <target> (Hilarious street-smart roast)
  if (clean.startsWith("!roast") || clean.startsWith("roast ")) {
    const target = clean.replace(/^(!roast|roast)\s*/i, "").trim() || "is bande ko";
    console.log(`🔥 Roasting target: "${target}"`);
    await message.channel.sendTyping();
    try {
      const roastPrompt = `Roast "${target}" in brutal, hilarious, sarcastic, street-smart Indian college/gaming Hinglish slang. Give a savage, witty one-liner or punchy comeback. Don't be polite or formal. Maximum 2 short sentences.`;
      const roastReply = await callGroqAi(roastPrompt);
      await message.reply(roastReply);
      if (voiceConnection) {
        await speakInVoice(roastReply);
      }
    } catch (err) {
      await message.reply(`⚠️ Roast nahi ho paya: ${err.message}`);
    }
    return;
  }

  // Command: !say <text> (Speaks exact text)
  if (clean.startsWith("!say") || clean.startsWith("say ")) {
    const textToSay = clean.replace(/^(!say|say)\s*/i, "").trim();
    if (!textToSay) {
      await message.reply("⚠️ Usage: `!say <kuch bhi bolo>`");
      return;
    }

    if (!voiceConnection) {
      await message.reply("⚠️ Main abhi voice channel me nahi hoon! Pehle `!join` bolo.");
      return;
    }

    await message.react("🗣️");
    await speakInVoice(textToSay);
    return;
  }

  // AI Commands: !ask, !speak, !chat, or @Bot mention, or any !prefix
  const isAiTrigger = isMention || 
    clean.startsWith("!ask") || clean.startsWith("ask ") ||
    clean.startsWith("!speak") || clean.startsWith("speak ") ||
    clean.startsWith("!chat") || clean.startsWith("chat ") ||
    clean.startsWith("!");

  if (isAiTrigger) {
    let prompt = clean
      .replace(/^(!ask|ask)\s*/i, "")
      .replace(/^(!speak|speak)\s*/i, "")
      .replace(/^(!chat|chat)\s*/i, "")
      .replace(/^!/, "")
      .trim();

    if (!prompt) {
      await message.reply("Bol bhai, kya sawal hai?");
      return;
    }

    console.log(`🧠 Asking AI (${CURRENT_MODEL}): "${prompt}"`);
    await message.channel.sendTyping();

    try {
      // 1. Call AI
      const aiReply = await callGroqAi(prompt);

      // 2. Reply in text
      await message.reply(aiReply);

      // 3. Speak in voice channel if connected!
      if (voiceConnection) {
        await speakInVoice(aiReply);
      }
    } catch (err) {
      console.error("AI error:", err);
      await message.reply(`⚠️ Bhai error aa gaya: \`${err.message}\``);
    }
  }
});

/**
 * Calls Groq AI or official OpenAI
 */
async function callGroqAi(prompt) {
  // If OpenAI key is supplied (starts with sk- and not gsk_), use OpenAI API endpoint
  const isOfficialOpenAI = AI_API_KEY && AI_API_KEY.startsWith("sk-") && !AI_API_KEY.startsWith("gsk_");
  const endpoint = isOfficialOpenAI 
    ? "https://api.openai.com/v1/chat/completions" 
    : "https://api.groq.com/openai/v1/chat/completions";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: CURRENT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      temperature: 0.8
    })
  });

  if (!res.ok) {
    throw new Error(`AI API error (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "No reply generated.";
}

/**
 * Synthesizes Type2Talk Edge Neural TTS and streams it live into Discord Voice Call
 */
async function speakInVoice(text) {
  if (!voiceConnection) return;

  // Ensure connection is Ready
  if (voiceConnection.state?.status !== VoiceConnectionStatus.Ready) {
    console.log(`⏳ Waiting for voice connection to reach Ready state (currently: ${voiceConnection.state?.status})...`);
    try {
      await entersState(voiceConnection, VoiceConnectionStatus.Ready, 15_000);
      console.log("✅ Voice connection is Ready, proceeding to play audio.");
    } catch (err) {
      console.error("❌ Cannot play audio: Voice connection not ready (" + voiceConnection.state?.status + ")");
      return;
    }
  }

  console.log(`🎙️ Speaking in voice call: "${text.substring(0, 100)}" with voice "${CURRENT_VOICE}"`);

  // Clean text for speech
  let clean = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`.*?`/g, "")
    .replace(/[*_#~[\]()]/g, "")
    .trim();

  // Take first 3 sentences or up to 350 chars
  const sentences = clean.split(/[.?!।\n]+/);
  let snippet = sentences.slice(0, 3).join(". ").trim();
  if (!snippet || snippet.length < 10) snippet = clean.substring(0, 300);
  if (snippet.length > 350) snippet = snippet.substring(0, 350);

  try {
    const audioBuffer = await generateAudioBuffer(snippet, CURRENT_VOICE);
    if (!audioBuffer || audioBuffer.length === 0) {
      console.warn("⚠️ Edge TTS generated 0 bytes of audio.");
      return;
    }
    console.log(`🎵 Edge TTS generated ${audioBuffer.length} bytes. Playing audio in voice call...`);
    const stream = Readable.from(audioBuffer);
    const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
    resource.playStream.on("error", (err) => console.error("❌ Audio resource stream error:", err.message));
    audioPlayer.play(resource);
  } catch (err) {
    console.error("❌ Voice playback error:", err);
  }
}

/**
 * Microsoft Edge Neural TTS Audio Buffer Generator (using msedge-tts v2.1.0)
 */
async function generateAudioBuffer(text, voice) {
  try {
    if (ttsVoiceConfigured !== voice) {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      ttsVoiceConfigured = voice;
    }
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    console.warn("⚠️ TTS stream error, retrying metadata and stream once...", err.message);
    ttsVoiceConfigured = "";
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    ttsVoiceConfigured = voice;
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}

client.login(BOT_TOKEN);
