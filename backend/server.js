// --- Minimal backend for presentation: Express + LowDB (file DB) ---
const express   = require("express");
const cors      = require("cors");
const jwt       = require("jsonwebtoken");
const bcrypt    = require("bcryptjs");
const low       = require("lowdb");
const FileSync  = require("lowdb/adapters/FileSync");

// ===== Config =====
const PORT       = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "demo-super-secret"; // demo only

// ===== DB (LowDB) =====
const adapter = new FileSync("db.json");
const db      = low(adapter);

// Ensure default structure exists
db.defaults({ users: [], unterkuenfte: [], reservierungen: [] }).write();

// ===== App =====
const app = express();
app.use(cors());
app.use(express.json());

// ===== Helpers =====
function createId(prefix = "") {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Missing token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET); // { id, email }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

// Simple health check
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, ts: Date.now() })
);

// =====================================================
// =============== AUTH (REGISTER / LOGIN) =============
// =====================================================
app.post("/api/auth/register", (req, res) => {
  const { firstName, lastName, email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: "email and password required" });
  }

  const exists = db.get("users").find({ email }).value();
  if (exists) {
    return res.status(409).json({ message: "Email already exists" });
  }

  const id     = createId("u_");
  const hashed = bcrypt.hashSync(password, 10);

  const user = { id, firstName, lastName, email, password: hashed };
  db.get("users").push(user).write();

  const accessToken = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: "7d" });
  res.json({
    accessToken,
    user: { id, firstName, lastName, email }
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.get("users").find({ email }).value();

  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  const ok = bcrypt.compareSync(password, user.password);
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });

  const accessToken = jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({
    accessToken,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email
    }
  });
});

// =====================================================
// =============== UNTERKÜNFTE (public GET) ============
// =====================================================
// Public read (useful to populate dropdowns)
app.get("/api/unterkuenfte", (_req, res) => {
  res.json(db.get("unterkuenfte").value());
});

// Mutations require auth
app.post("/api/unterkuenfte", authMiddleware, (req, res) => {
  const item = { id: createId("u_"), ...req.body };
  db.get("unterkuenfte").push(item).write();
  res.status(201).json(item);
});

app.put("/api/unterkuenfte/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  const exists = db.get("unterkuenfte").find({ id }).value();
  if (!exists) return res.status(404).json({ message: "Not found" });

  const updated = { ...exists, ...req.body, id };
  db.get("unterkuenfte").find({ id }).assign(updated).write();
  res.json(updated);
});

app.delete("/api/unterkuenfte/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  db.get("unterkuenfte").remove({ id }).write();
  res.status(204).end();
});

// =====================================================
// ============ RESERVIERUNGEN (USER-SCOPED) ===========
// =====================================================
// IMPORTANT: There must be NO public version of this route.
// Only return current user's reservations.
app.get("/api/reservierungen", authMiddleware, (req, res) => {
  const list = db.get("reservierungen")
    .filter({ userId: req.user.id })
    .value();
  res.json(list);
});

// Create reservation for the current user (stamps userId)
app.post("/api/reservierungen", authMiddleware, (req, res) => {
  const item = {
    id: createId("r_"),
    userId: req.user.id,
    ...req.body
  };
  db.get("reservierungen").push(item).write();
  res.status(201).json(item);
});

// Update only if reservation belongs to current user
app.put("/api/reservierungen/:id", authMiddleware, (req, res) => {
  const { id } = req.params;

  const exists = db.get("reservierungen")
    .find({ id, userId: req.user.id })
    .value();

  if (!exists) return res.status(404).json({ message: "Not found" });

  const updated = { ...exists, ...req.body, id, userId: req.user.id };
  db.get("reservierungen").find({ id }).assign(updated).write();
  res.json(updated);
});

// Delete only own reservation
app.delete("/api/reservierungen/:id", authMiddleware, (req, res) => {
  const { id } = req.params;

  const before = db.get("reservierungen").value().length;
  db.get("reservierungen").remove({ id, userId: req.user.id }).write();
  const after = db.get("reservierungen").value().length;

  if (before === after) {
    return res.status(404).json({ message: "Not found" });
  }
  res.status(204).end();
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`Backend running at http://127.0.0.1:${PORT}`);
});
