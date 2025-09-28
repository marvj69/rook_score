const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const DATA_DIRECTORY = path.resolve(__dirname, process.env.DATA_DIRECTORY || '../secure-data');

if (!SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in server/.env');
  process.exit(1);
}

if (!GOOGLE_CLIENT_ID) {
  console.error('GOOGLE_CLIENT_ID must be set in server/.env');
  process.exit(1);
}

fs.mkdirSync(DATA_DIRECTORY, { recursive: true });

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
};

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cors(corsOptions));

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function resolveUserPath(userId) {
  const safeId = userId.replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(DATA_DIRECTORY, `${safeId}.json`);
}

function readUserData(userId) {
  const filePath = resolveUserPath(userId);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to read data for user ${userId}:`, error);
    return {};
  }
}

function writeUserData(userId, data) {
  const filePath = resolveUserPath(userId);
  const payload = { ...data, timestamp: new Date().toISOString() };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    const payload = jwt.verify(token, SESSION_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    console.warn('Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/config', (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

app.post('/auth/google', async (req, res) => {
  const { credential } = req.body || {};

  if (!credential) {
    return res.status(400).json({ error: 'Missing Google credential' });
  }

  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();

    if (!payload || !payload.sub) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name || '',
      picture: payload.picture || '',
    };

    const sessionToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
      SESSION_SECRET,
      { expiresIn: '7d' }
    );

    const existing = readUserData(user.id);
    if (!existing || typeof existing !== 'object') {
      writeUserData(user.id, {});
    }

    res.json({ token: sessionToken, user });
  } catch (error) {
    console.error('Google auth verification failed:', error);
    res.status(401).json({ error: 'Google token verification failed' });
  }
});

app.post('/auth/signout', (_req, res) => {
  res.json({ success: true });
});

app.get('/api/data', authenticate, (req, res) => {
  const data = readUserData(req.user.sub);
  res.json({ data });
});

app.put('/api/data', authenticate, (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Data payload must be an object' });
  }
  const merged = writeUserData(req.user.sub, data);
  res.json({ data: merged });
});

app.patch('/api/data', authenticate, (req, res) => {
  const { key, value } = req.body || {};
  if (typeof key !== 'string' || !key.length) {
    return res.status(400).json({ error: 'Key must be a non-empty string' });
  }

  const current = readUserData(req.user.sub);

  if (value === null) {
    delete current[key];
  } else {
    current[key] = value;
  }

  const updated = writeUserData(req.user.sub, current);
  res.json({ data: updated });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Secure backend listening on port ${PORT}`);
});
