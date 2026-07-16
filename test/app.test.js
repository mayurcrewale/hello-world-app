const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const app = require("../src/index");

function get(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ statusCode: res.statusCode, body: JSON.parse(body) })
        );
      })
      .on("error", reject);
  });
}

test("GET /health returns ok", async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const res = await get(server, "/health");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "ok");
});

test("GET /users returns the seeded user list", async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());

  const res = await get(server, "/users");
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.users));
  assert.ok(res.body.users.length > 0);
});
