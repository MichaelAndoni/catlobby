# 🐱 Cat Lobby — EC2 Deployment Guide
## Stack: Node.js + PostgreSQL + Redis on Ubuntu 22.04

---

## 1. Connect to your EC2 instance

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

---

## 2. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should print v20.x.x
```

---

## 3. Install PostgreSQL

```bash
sudo apt-get install -y postgresql postgresql-contrib

# Start and enable on boot
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << 'SQL'
CREATE DATABASE catlobby;
CREATE USER catuser WITH ENCRYPTED PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE catlobby TO catuser;
\q
SQL
```

> **Change `yourpassword`** to something strong. You'll use it in your `.env`.

---

## 4. Install Redis

```bash
sudo apt-get install -y redis-server

# Configure Redis to start on boot
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Verify it's running
redis-cli ping   # should return PONG
```

---

## 5. Install Nginx (reverse proxy)

```bash
sudo apt-get install -y nginx

# Create site config
sudo tee /etc/nginx/sites-available/catlobby << 'NGINX'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

sudo ln -s /etc/nginx/sites-available/catlobby /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

---

## 6. Upload your game files

Run this **from your local machine**:

```bash
scp -i your-key.pem -r ./catlobby ubuntu@YOUR_EC2_IP:~/catlobby
```

---

## 7. Configure environment

```bash
cd ~/catlobby
cp .env.example .env
nano .env
```

Fill in these values:

```env
PORT=3000
APP_URL=http://YOUR_EC2_PUBLIC_IP

JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">

DATABASE_URL=postgresql://catuser:yourpassword@localhost:5432/catlobby
DB_SSL=false

REDIS_URL=redis://localhost:6379

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=your_app_password
EMAIL_FROM="Cat Lobby <your_gmail@gmail.com>"
```

Save and exit (`Ctrl+X`, then `Y`, then `Enter`).

---

## 8. Install dependencies and start with PM2

```bash
cd ~/catlobby
npm install

# Install PM2 globally
sudo npm install -g pm2

# Start the app
pm2 start server.js --name catlobby

# Save PM2 config so it restarts after reboot
pm2 save
pm2 startup   # copy-paste the command it outputs and run it
```

---

## 9. Open ports in AWS Security Group

In the AWS Console:
- Go to **EC2 → Security Groups → your instance's group → Edit Inbound Rules**
- Add these rules:

| Type       | Port | Source    |
|------------|------|-----------|
| HTTP       | 80   | 0.0.0.0/0 |
| Custom TCP | 3000 | 0.0.0.0/0 |
| SSH        | 22   | Your IP   |

---

## 10. Access your game

```
http://YOUR_EC2_PUBLIC_IP
```

---

## Useful commands

```bash
# View live logs
pm2 logs catlobby

# Restart after uploading new files
pm2 restart catlobby

# Check status
pm2 status

# Connect to Postgres directly
sudo -u postgres psql catlobby

# Check Redis
redis-cli ping

# Restart Nginx
sudo systemctl restart nginx
```

---

## Deploying updates

From your local machine:

```bash
# Upload changed files
scp -i your-key.pem -r ./catlobby ubuntu@YOUR_EC2_IP:~/catlobby

# SSH in and restart
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
cd ~/catlobby && npm install && pm2 restart catlobby
```

---

## Optional: Add a domain + HTTPS (Let's Encrypt)

```bash
sudo apt-get install -y certbot python3-certbot-nginx

# Replace yourdomain.com with your actual domain
# (Your domain's DNS A record must point to this EC2 IP first)
sudo certbot --nginx -d yourdomain.com

# Auto-renew
sudo systemctl enable certbot.timer
```

Then update your `.env`:
```env
APP_URL=https://yourdomain.com
NODE_ENV=production
```

And restart: `pm2 restart catlobby`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `❌ Failed to connect to database` | Check `DATABASE_URL` in `.env` and that postgres is running: `sudo systemctl status postgresql` |
| Nginx 502 Bad Gateway | App crashed — check `pm2 logs catlobby` |
| Can't connect on port 80 | Check AWS Security Group has port 80 open |
| Emails not sending | Check SMTP credentials; verify URL will print to `pm2 logs` in dev mode |
| Redis connection refused | `sudo systemctl start redis-server` |
