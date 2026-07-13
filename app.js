require("dotenv").config();

const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

(async () => {

  await app.start(process.env.PORT || 3000);

  console.log("⚡ Attendance Bot is running!");

  await app.client.chat.postMessage({
    channel: "#attendance",
    text: "Attendance",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*☀️ Good Morning!*\n\nPlease record your attendance."
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "🟢 Time In"
            },
            style: "primary",
            action_id: "time_in"
          }
        ]
      }
    ]
  });

})();
