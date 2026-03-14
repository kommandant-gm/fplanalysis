const express = require('express');
const router = express.Router();
const {
  getAdminConfig,
  issueAdminToken,
  safeEqual,
  requireAdmin,
} = require('../middleware/adminAuth');

router.post('/login', (req, res) => {
  const config = getAdminConfig();
  if (!config.password || !config.secret) {
    return res.status(500).json({
      success: false,
      error: 'Admin auth is not configured on server.',
    });
  }

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const validUser = safeEqual(username, config.username);
  const validPass = safeEqual(password, config.password);
  if (!validUser || !validPass) {
    return res.status(401).json({ success: false, error: 'Invalid username or password.' });
  }

  const token = issueAdminToken(config.username, config);
  return res.json({
    success: true,
    token,
    expiresIn: config.tokenTtlSeconds,
    user: { username: config.username, role: 'admin' },
  });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({
    success: true,
    user: {
      username: req.admin.sub,
      role: req.admin.role,
      expiresAt: req.admin.exp,
    },
  });
});

router.post('/logout', requireAdmin, (_req, res) => {
  res.json({ success: true });
});

module.exports = router;
