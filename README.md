# Stargaze NFT P2P Marketplace

A React-based peer-to-peer NFT marketplace for the Stargaze blockchain. Users can create offers to trade NFTs with optional STARS tokens, browse active offers, and execute trades through wallet integration.

Screenshot:
![screencapture-app-usemiddleman-xyz-2025-09-04-20_09_27](https://github.com/user-attachments/assets/2e6f963a-9c9d-4551-b7cf-cbc78bd8c790)

Video of how it works:
https://x.com/love_4_crypto/status/1958181842764304404

## Features

- 🔗 **Wallet Integration**: Supports Keplr and Leap wallets
- 🖼️ **NFT Trading**: Browse and select NFTs from your collection
- 💰 **STARS Integration**: Add STARS tokens to your offers
- 📊 **Floor Price Display**: Shows USD values based on current market data
- ⚡ **Real-time Offers**: View and interact with active marketplace offers
- 🔍 **Collection Search**: Browse NFTs by collection

## Tech Stack

- React 18 with TypeScript
- Vite for build tooling
- CosmJS for blockchain interaction
- Custom CSS styling

## Prerequisites

- Node.js 16+ and npm/yarn
- A Keplr or Leap wallet browser extension
- STARS tokens for trading (optional)

## Local Development

### 1. Clone the Repository
```bash
git clone <your-repo-url>
cd p2pusemiddleman-react
```

### 2. Install Dependencies
```bash
npm install
# or
yarn install
```

### 3. Environment Setup
The `.env` file contains public configuration (safe to commit):
```properties
VITE_RPC=https://rpc.stargaze-apis.com
VITE_CHAIN_ID=stargaze-1
VITE_PEGASUS_CONTRACT=stars199wg569k4z3qutmm7st5kv488c2us633tnxj3jzj0ye9ma2q4lfs6t50qt
```

### 4. Start Development Server
```bash
npm run dev
# or
yarn dev
```

The app will be available at `http://localhost:5173`

## Digital Ocean Deployment

### Option 1: Static Site Deployment (Recommended)

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Deploy to Digital Ocean App Platform:**
   - Go to [Digital Ocean Apps](https://cloud.digitalocean.com/apps)
   - Click "Create App"
   - Connect your GitHub repository
   - Configure build settings:
     - **Build Command**: `npm run build`
     - **Output Directory**: `dist`
     - **Node Version**: 18.x
   - Set environment variables in the app settings (same as `.env`)
   - Deploy

### Option 2: Droplet Deployment

1. **Create a Digital Ocean Droplet:**
   - Choose Ubuntu 22.04 LTS
   - Select appropriate size (Basic $6/month works for small apps)
   - Add your SSH key

2. **Connect and setup:**
   ```bash
   ssh root@your-droplet-ip
   
   # Update system
   apt update && apt upgrade -y
   
   # Install Node.js 18
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   apt-get install -y nodejs
   
   # Install nginx
   apt install nginx -y
   
   # Install PM2 for process management
   npm install -g pm2
   ```

3. **Deploy your app:**
   ```bash
   # Clone your repository
   git clone <your-repo-url>
   cd p2pusemiddleman-react
   
   # Install dependencies
   npm install
   
   # Build the project
   npm run build
   
   # Copy build files to nginx
   cp -r dist/* /var/www/html/
   
   # Start nginx
   systemctl start nginx
   systemctl enable nginx
   ```

4. **Configure Nginx (optional, for custom domain):**
   ```bash
   nano /etc/nginx/sites-available/default
   ```
   
   Update the server block to serve your app and handle client-side routing.

### Option 3: Docker Deployment

1. **Create Dockerfile:**
   ```dockerfile
   FROM node:18-alpine as build
   WORKDIR /app
   COPY package*.json ./
   RUN npm install
   COPY . .
   RUN npm run build
   
   FROM nginx:alpine
   COPY --from=build /app/dist /usr/share/nginx/html
   EXPOSE 80
   CMD ["nginx", "-g", "daemon off;"]
   ```

2. **Deploy to Digital Ocean Container Registry or App Platform**

## Usage

1. **Connect Wallet**: Click "Connect Wallet" and choose Keplr or Leap
2. **Browse NFTs**: Your owned NFTs will load automatically
3. **Create Offer**: 
   - Select NFTs you want to offer
   - Optionally add STARS amount
   - Enter peer address (recipient)
   - Set expiry date
   - Submit offer
4. **View Offers**: Browse active marketplace offers
5. **Accept Offers**: Click "Accept" on offers made to you

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_RPC` | Stargaze RPC endpoint | `https://rpc.stargaze-apis.com` |
| `VITE_CHAIN_ID` | Blockchain chain ID | `stargaze-1` |
| `VITE_PEGASUS_CONTRACT` | Smart contract address | `stars199wg5...` |

## Security Notes

- All environment variables are public (prefixed with `VITE_`)
- No private keys or secrets are stored in the codebase
- Wallet private keys remain in browser extensions
- All transactions require user approval through wallet

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License

## Support

For issues or questions:
- Open a GitHub issue
- Check existing documentation
- Review smart contract details on [Stargaze](https://stargaze.zone)
