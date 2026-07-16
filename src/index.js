const os = require("os");
const express = require("express");
const { USERS } = require("./users");

const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({ message: "Hello, World!", host: os.hostname() });
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

app.get("/users", (req, res) => {
  res.status(200).json({ users: USERS });
});

if (require.main === module) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`hello-world-app listening on port ${port}`);
  });
}

module.exports = app;
