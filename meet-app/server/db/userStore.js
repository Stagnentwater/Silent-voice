const fs = require("fs/promises");
const path = require("path");

const USERS_FILE = path.join(__dirname, "users.json");

let writeQueue = Promise.resolve();

async function ensureUsersFile() {
  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, "[]", "utf8");
  }
}

async function readUsers() {
  await ensureUsersFile();
  const raw = await fs.readFile(USERS_FILE, "utf8");
  const parsed = JSON.parse(raw || "[]");
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid users store format");
  }
  return parsed;
}

async function writeUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function queueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

async function findUserByUsername(username) {
  const users = await readUsers();
  const user = users.find((entry) => entry.username === username);
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    passwordHash: user.password_hash,
  };
}

async function addUser({ id, username, passwordHash }) {
  return queueWrite(async () => {
    const users = await readUsers();
    const exists = users.some((entry) => entry.username === username);
    if (exists) {
      const error = new Error("Username already exists");
      error.code = "DUPLICATE_USERNAME";
      throw error;
    }

    users.push({
      id,
      username,
      password_hash: passwordHash,
    });

    await writeUsers(users);
    return { id, username };
  });
}

module.exports = {
  findUserByUsername,
  addUser,
};
