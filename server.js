require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

app.set('trust proxy', 1); // required when running behind Railway / Heroku / nginx

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-please-change',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,  // 24 hours
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));

// API routes
app.use('/api', require('./routes/team'));
app.use('/admin', require('./routes/admin'));

// Team player page  —  /t/:slug
app.get('/t/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'team.html'));
});

// Admin UI  —  /admin and any sub-path
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Start reminder scheduler
require('./services/scheduler');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Badminton app running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
