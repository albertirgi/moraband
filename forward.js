const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const input = require("input"); // For interactive login
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const ROLE_ID2 = "1314446801742331944";

// Configuration
const configPath = path.join(__dirname, "config.json");
let config = {};

// Load or initialize config
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} else {
  config = {
    apiId: YOUR_TELEGRAM_API_ID, // Replace with your actual API ID
    apiHash: "YOUR_TELEGRAM_API_HASH", // Replace with your actual API Hash
    sessionString: "",
    discordWebhookURL: "YOUR_DISCORD_WEBHOOK_URL", // Replace with your Discord webhook URL
    targetGroup: "YOUR_TELEGRAM_GROUP_NAME_OR_ID", // Replace with your target group ID
    targetTopicId: 12345,
    targetTopicId2: 12345, // Replace this with the top-level message ID of the desired topic
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
  console.log(
    "Created config.json. Please update it with your credentials and the targetTopicId."
  );
  process.exit(0);
}

const {
  apiId,
  apiHash,
  sessionString,
  discordWebhookURL,
  targetGroup,
  targetTopicId,
  targetTopicId2,
} = config;

// Initialize Telegram client
const client = new TelegramClient(
  new StringSession(sessionString),
  apiId,
  apiHash,
  {
    connectionRetries: 5,
  }
);

(async () => {
  try {
    await client.start({
      phoneNumber: async () => await input.text("Enter your phone number: "),
      password: async () => await input.text("Enter your password: "),
      phoneCode: async () => await input.text("Enter the code you received: "),
      onError: (err) => console.log("Telegram Client Error:", err),
    });

    console.log("Telegram client connected.");

    // Save the session string for future use
    config.sessionString = client.session.save();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

    // Get the target group entity
    let group;
    try {
      group = await client.getEntity(targetGroup);
    } catch (error) {
      console.error("Failed to find the target group:", error.message);
      process.exit(1);
    }

    console.log(`Listening to messages from: ${group.title}`);

    // Event handler for new messages
    client.addEventHandler(
      async (event) => {
        const message = event.message;

        // Validate replyTo object and check if it matches the target topic
        const replyToMsgId = message.replyTo?.replyToMsgId;
        if (replyToMsgId !== targetTopicId && replyToMsgId !== targetTopicId2) {
          console.log("Message is not part of the desired topic:", {
            replyToMsgId,
            targetTopicId,
            targetTopicId2,
          });
          return;
        }

        const sender = await message.getSender();
        const senderName = sender
          ? sender.firstName || sender.username || "Unknown"
          : "Unknown";

        // Get the message content and remove "@everyone" mentions
        let content = message.message || "";
        content = content.replace(/@everyone/g, "");

        // Initialize the message content with role mention
        let messageContent = `<@&${ROLE_ID2}>

${content}`;

        // Check if the message has media (specifically a photo)
        if (message.media && message.media.photo) {
          try {
            console.log("Message contains a photo. Attempting to download.");

            // Download the photo as a buffer
            const buffer = await client.downloadMedia(message.media);

            if (!buffer) {
              throw new Error("Failed to download media buffer.");
            }

            console.log(`Downloaded buffer of size: ${buffer.length} bytes`);

            // Prepare FormData for Discord webhook
            const form = new FormData();
            form.append("content", messageContent);
            form.append("file", buffer, {
              filename: `image_${Date.now()}.jpg`,
              contentType: "image/jpeg",
            });

            // Send the payload to Discord
            await axios.post(discordWebhookURL, form, {
              headers: form.getHeaders(),
            });

            console.log(
              `Forwarded message with image from ${senderName}: ${content}`
            );
          } catch (err) {
            console.error("Error handling image:", err.message);
            // Fallback: Send only text if image handling fails
            try {
              await axios.post(discordWebhookURL, { content: messageContent });
              console.log(`Forwarded text from ${senderName}: ${content}`);
            } catch (error) {
              console.error("Error sending text to Discord:", error.message);
            }
          }
        } else {
          // If no media, send only the text content
          try {
            await axios.post(discordWebhookURL, { content: messageContent });
            console.log(`Forwarded message from ${senderName}: ${content}`);
          } catch (error) {
            console.error("Error sending to Discord:", error.message);
          }
        }
      },
      new NewMessage({ chats: [group.id] })
    );

    console.log("Bot is running. Press Ctrl+C to exit.");
  } catch (err) {
    console.error("An unexpected error occurred:", err.message);
  }
})();
