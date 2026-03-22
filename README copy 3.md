# 🐱 Cat Lobby — Multiplayer Game

A cute top-down multiplayer cat lobby with real-time chat, built with Node.js + Socket.IO.

---

## Running Locally

```bash
npm install
npm start
# Open http://localhost:3000
```

For live reload during development:
```bash
npm run dev
```

---

## Hosting Options

### ✅ Option 1: Render.com (EASIEST — Free tier available)

1. Push this folder to a GitHub repo
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
5. Deploy — you'll get a live URL like `https://catlobby.onrender.com`
6. Share the URL with friends!

> ⚠️ Free tier spins down after inactivity. Paid tier ($7/mo) stays always-on.

---

### ✅ Option 2: Railway.app (Very easy, ~$5/mo)

1. Push to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. It auto-detects Node.js and deploys
4. You get a live URL instantly

---

### ✅ Option 3: AWS EC2 (Full control)

**Step-by-step:**

1. **Launch EC2 instance**
   - Go to AWS Console → EC2 → Launch Instance
   - Choose: Ubuntu 22.04 LTS (free tier: t2.micro)
   - Create a key pair (.pem file) and download it
   - Security Group: Allow inbound TCP on port 3000 (or 80)

2. **Connect to your instance**
   ```bash
   chmod 400 your-key.pem
   ssh -i your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
   ```

3. **Install Node.js on the server**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

4. **Upload your game files**
   ```bash
   # From your local machine:
   scp -i your-key.pem -r ./catlobby ubuntu@YOUR_EC2_IP:~/catlobby
   ```

5. **Start the server with PM2 (keeps it running)**
   ```bash
   cd ~/catlobby
   npm install
   sudo npm install -g pm2
   pm2 start server.js --name catlobby
   pm2 save
   pm2 startup
   ```

6. **Open port 3000 in AWS Security Group**
   - EC2 → Security Groups → Edit Inbound Rules
   - Add: Custom TCP, Port 3000, Source: 0.0.0.0/0

7. **Access your game**
   - Share: `http://YOUR_EC2_PUBLIC_IP:3000`

**Optional: Use port 80 with nginx proxy**
```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/catlobby
```
Paste:
```nginx
server {
    listen 80;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/catlobby /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```
Now players can connect at `http://YOUR_EC2_IP` (no port needed).

---

### ✅ Option 4: Fly.io (Great free tier, Docker-based)

1. Install flyctl: https://fly.io/docs/hands-on/install-flyctl/
2. In your project folder:
   ```bash
   fly launch    # follow prompts
   fly deploy
   ```
3. Get a live URL like `https://catlobby.fly.dev`

---

## Adding a Custom Domain

Once hosted anywhere, you can point a domain to it:
1. Buy a domain (Namecheap, Cloudflare, etc.)
2. Add an A record pointing to your server's IP
3. Optionally add HTTPS via Let's Encrypt / Certbot

---

## Scaling

For many players, Socket.IO needs a Redis adapter to sync across multiple server instances:

```bash
npm install @socket.io/redis-adapter redis
```

For a casual lobby game, a single t2.small EC2 (~$10/mo) handles 100+ concurrent players easily.
