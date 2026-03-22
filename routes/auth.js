'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db       = require('../config/db');
const mailer   = require('../services/mailer');

const router     = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const getAppUrl  = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

function verifyPage(message, success) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cat Lobby</title>
<style>body{background:#1a1025;color:#f0e6ff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#231533;border:1px solid #3d2060;border-radius:18px;padding:40px;text-align:center;max-width:400px}
h1{font-size:32px;margin:0 0 8px}p{color:#9b8ab0;margin:0 0 24px;font-size:15px}
a{background:linear-gradient(135deg,#c77dff,#ff9de2);color:#1a0030;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:800}
.err{color:#ef5350}</style></head><body>
<div class="box"><h1>🐱 Cat Lobby</h1><p class="${success?'':'err'}">${message}</p>
${success?'<a href="/">Go to the Lobby \u2192</a>':'<a href="/">Back to Lobby</a>'}</div></body></html>`;
}

router.post('/signup', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    if (!email||!password||!username) return res.status(400).json({error:'All fields required.'});
    if (password.length < 6)          return res.status(400).json({error:'Password must be at least 6 characters.'});
    if (username.trim().length < 2)   return res.status(400).json({error:'Username must be at least 2 characters.'});
    if (await db.getUserByEmail(email)) return res.status(409).json({error:'An account with that email already exists.'});
    const passwordHash=await bcrypt.hash(password,12);
    const colorIndex=Math.floor(Math.random()*8);
    const userId=uuidv4();
    const guestCoins=parseInt(req.body.guestCoins)||0;
    const guestInventory=req.body.guestInventory?JSON.parse(req.body.guestInventory):[];
    const cleanUsername=username.trim().substring(0,16);
    await db.createUser({id:userId,email,passwordHash,username:cleanUsername,colorIndex});
    if (guestCoins>0||guestInventory.length>0) await db.updatePlayerData({id:userId,username:cleanUsername,colorIndex,coins:guestCoins,inventory:guestInventory,outfit:{}});
    const verifyToken=uuidv4();
    await db.createVerifyToken(verifyToken,userId);
    const verifyUrl=`${getAppUrl()}/auth/verify?token=${verifyToken}`;
    try { await mailer.sendVerificationEmail(email,cleanUsername,verifyUrl); }
    catch(e){ console.error('[mailer]',e.message); console.log('[dev] Verify URL:',verifyUrl); }
    res.json({ok:true});
  } catch(err){ console.error('[signup]',err); res.status(500).json({error:'Server error.'}); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({error:'Email and password required.'});
    const user=await db.getUserByEmail(email);
    if (!user) return res.status(401).json({error:'Invalid email or password.'});
    if (!await bcrypt.compare(password,user.password_hash)) return res.status(401).json({error:'Invalid email or password.'});
    if (!user.verified) return res.status(403).json({error:'Please verify your email before logging in.',needsVerification:true});
    const token=jwt.sign({userId:user.id},JWT_SECRET,{expiresIn:'30d'});
    res.cookie('auth_token',token,{httpOnly:true,maxAge:30*24*60*60*1000,sameSite:'lax',secure:process.env.NODE_ENV==='production'});
    res.json({ok:true,user:{id:user.id,username:user.username,email:user.email,colorIndex:user.color_index,coins:user.coins,inventory:user.inventory,outfit:user.outfit||{}},token});
  } catch(err){ console.error('[login]',err); res.status(500).json({error:'Server error.'}); }
});

router.get('/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.send(verifyPage('Invalid link.',false));
    const row=await db.getAndDeleteVerifyToken(token);
    if (!row) return res.send(verifyPage('This link has expired or already been used.',false));
    await db.setVerified(row.user_id);
    res.send(verifyPage('Your email is verified! You can now log in.',true));
  } catch(err){ console.error('[verify]',err); res.send(verifyPage('Server error. Please try again.',false)); }
});

router.get('/me', async (req, res) => {
  try {
    const token=req.cookies.auth_token||req.headers.authorization?.replace('Bearer ','');
    if (!token) return res.json({user:null});
    const { userId }=jwt.verify(token,JWT_SECRET);
    const user=await db.getUserById(userId);
    if (!user||!user.verified) return res.json({user:null});
    res.json({user:{id:user.id,username:user.username,email:user.email,colorIndex:user.color_index,coins:user.coins,inventory:user.inventory,outfit:user.outfit||{}}});
  } catch { res.json({user:null}); }
});

router.post('/logout', (req, res) => { res.clearCookie('auth_token'); res.json({ok:true}); });

router.post('/resend-verification', async (req, res) => {
  try {
    const { email }=req.body;
    if (!email) return res.status(400).json({error:'Email required.'});
    const user=await db.getUserByEmail(email);
    if (!user||user.verified) return res.json({ok:true});
    const tok=uuidv4(); await db.createVerifyToken(tok,user.id);
    const url=`${getAppUrl()}/auth/verify?token=${tok}`;
    try { await mailer.sendVerificationEmail(email,user.username,url); }
    catch(e){ console.error('[mailer] resend:',e.message); console.log('[dev] Verify URL:',url); }
    res.json({ok:true});
  } catch(err){ res.status(500).json({error:'Server error.'}); }
});

module.exports = router;
